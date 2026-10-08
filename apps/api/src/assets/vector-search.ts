import type { Env } from '@/env'
import type { AssetRow } from './assets.repository'

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5'

type VectorMatch = {
  id: string
  score?: number
}

function splitAssetFilename(filename: string): { folder: string; basename: string } {
  const normalized = filename.replace(/\\/g, '/').trim()
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length <= 1) {
    return { folder: '', basename: segments[0] ?? normalized }
  }

  return {
    folder: segments.slice(0, -1).join('/'),
    basename: segments[segments.length - 1] ?? normalized,
  }
}

function buildVectorId(assetId: string, tenantId?: string): string {
  return `${tenantId ?? 'global'}:${assetId}`
}

function toNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null

  if (value.every((entry) => typeof entry === 'number')) {
    return value as number[]
  }

  if (
    value.length > 0 &&
    Array.isArray(value[0]) &&
    (value[0] as unknown[]).every((v) => typeof v === 'number')
  ) {
    return value[0] as number[]
  }

  return null
}

function extractEmbedding(payload: unknown): number[] | null {
  const candidates: unknown[] = []

  if (payload && typeof payload === 'object') {
    const top = payload as Record<string, unknown>
    candidates.push(top.result)
    if (top.result && typeof top.result === 'object') {
      const nested = top.result as Record<string, unknown>
      candidates.push(nested.data)
      candidates.push(nested.embedding)
      candidates.push(nested[0])
    }
    candidates.push(top.data)
  }

  candidates.push(payload)

  for (const candidate of candidates) {
    const vector = toNumberArray(candidate)
    if (vector && vector.length > 0) {
      return vector
    }
  }

  return null
}

async function createEmbedding(workerEnv: Env, input: string): Promise<number[] | null> {
  if (!workerEnv.CF_API_TOKEN || !workerEnv.CLOUDFLARE_ACCOUNT_ID) {
    return null
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${workerEnv.CLOUDFLARE_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${workerEnv.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: [input] }),
    }
  )

  if (!response.ok) {
    return null
  }

  const payload = (await response.json()) as unknown
  return extractEmbedding(payload)
}

function buildSearchText(asset: Pick<AssetRow, 'filename' | 'mimeType'>): string {
  const { folder, basename } = splitAssetFilename(asset.filename)
  return [basename, folder, asset.filename, asset.mimeType].filter(Boolean).join(' | ')
}

export async function indexAssetVector(
  workerEnv: Env,
  asset: Pick<AssetRow, 'id' | 'filename' | 'mimeType'>,
  tenantId?: string
): Promise<void> {
  if (!workerEnv.ASSET_VECTORS) {
    return
  }

  const text = buildSearchText(asset)
  const embedding = await createEmbedding(workerEnv, text)
  if (!embedding) {
    return
  }

  const { folder, basename } = splitAssetFilename(asset.filename)

  const index = workerEnv.ASSET_VECTORS as unknown as {
    upsert: (vectors: Record<string, unknown>[]) => Promise<unknown>
  }

  await index.upsert([
    {
      id: buildVectorId(asset.id, tenantId),
      values: embedding,
      metadata: {
        assetId: asset.id,
        tenantId: tenantId ?? 'global',
        filename: asset.filename,
        basename,
        folder,
        mimeType: asset.mimeType,
      },
    },
  ])
}

export async function removeAssetVectors(
  workerEnv: Env,
  assetIds: string[],
  tenantId?: string
): Promise<void> {
  if (!workerEnv.ASSET_VECTORS || assetIds.length === 0) {
    return
  }

  const index = workerEnv.ASSET_VECTORS as unknown as {
    deleteByIds: (ids: string[]) => Promise<unknown>
  }

  await index.deleteByIds(assetIds.map((id) => buildVectorId(id, tenantId)))
}

export async function searchAssetVectorIds(
  workerEnv: Env,
  input: { query: string; topK: number },
  tenantId?: string
): Promise<VectorMatch[]> {
  if (!workerEnv.ASSET_VECTORS) {
    return []
  }

  const embedding = await createEmbedding(workerEnv, input.query)
  if (!embedding) {
    return []
  }

  const index = workerEnv.ASSET_VECTORS as unknown as {
    query: (
      vector: number[],
      options: { topK: number; returnMetadata: boolean; filter?: Record<string, unknown> }
    ) => Promise<{ matches?: Array<{ id: string; score?: number }> }>
  }

  const result = await index.query(embedding, {
    topK: input.topK,
    returnMetadata: false,
    filter: { tenantId: tenantId ?? 'global' },
  })

  return (result.matches ?? []).filter((match) => typeof match.id === 'string')
}
