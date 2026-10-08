import type { Database } from '@/database/db'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { type AssetWithVariants, assetsRepository } from './assets.repository'
import {
  DEFAULT_ASSET_ALLOWED_MIME_TYPES,
  isAllowedAssetMimeType,
  isDangerousAssetFile,
  normalizeAllowedAssetMimeTypes,
  resolveAssetMimeType,
} from './file-policy'
import { buildOriginalKey, buildVariantKey } from './r2-keys'
import { indexAssetVector, removeAssetVectors, searchAssetVectorIds } from './vector-search'

export interface UploadAssetInput {
  filename: string
  mimeType: string
  contentBase64: string
  width?: number
  height?: number
  blurhash?: string
  variants?: Array<{
    variant: string
    format: string
    width?: number
    height?: number
    contentBase64?: string
  }>
}

export interface SemanticAssetSearchInput {
  query: string
  limit?: number
  folder?: string
  mimeTypePrefix?: string
}

type DeferAssetVectorWork = (promise: Promise<unknown>) => void

async function runInChunks<T>(items: T[], chunkSize: number, fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize)
    await Promise.allSettled(chunk.map((item) => fn(item)))
  }
}

function bytesFromBase64(base64: string): Uint8Array {
  const buf = Buffer.from(base64, 'base64')
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

function estimateDecodedSize(base64: string): number {
  const normalized = base64.trim()
  if (normalized.length === 0) return 0
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.floor((normalized.length * 3) / 4) - padding
}

export const DEFAULT_ASSET_UPLOAD_MAX_BYTES = 5 * 1024 * 1024
export const DEFAULT_ASSET_UPLOAD_MAX_DIMENSION = 2048
export { DEFAULT_ASSET_ALLOWED_MIME_TYPES, normalizeAllowedAssetMimeTypes }

function buildUploadTooLargeMessage(maxUploadBytes: number) {
  return `Asset upload exceeds maximum size of ${maxUploadBytes} bytes`
}

function buildUploadTypeBlockedMessage(mimeType: string) {
  return `Asset upload type is not allowed: ${mimeType || 'unknown'}`
}

function scheduleAssetVectorWork(
  promise: Promise<unknown>,
  defer: DeferAssetVectorWork | undefined
) {
  if (defer) {
    defer(promise)
    return
  }

  void promise
}

export const assetsService = {
  async upload(
    db: Database,
    r2: R2Bucket,
    input: UploadAssetInput,
    tenantId?: string,
    workerEnv?: Env,
    createdBy?: string,
    defer?: DeferAssetVectorWork,
    maxUploadBytes = DEFAULT_ASSET_UPLOAD_MAX_BYTES,
    _maxUploadDimension = DEFAULT_ASSET_UPLOAD_MAX_DIMENSION,
    allowedMimeTypes = [...DEFAULT_ASSET_ALLOWED_MIME_TYPES]
  ) {
    const tenantScope = tenantId ?? 'global'
    const now = new Date().toISOString()
    const assetId = crypto.randomUUID()
    const originalKey = buildOriginalKey(tenantScope, assetId, input.filename)
    const mimeType = resolveAssetMimeType(input.filename, input.mimeType)
    const normalizedAllowedMimeTypes = normalizeAllowedAssetMimeTypes(allowedMimeTypes)

    if (
      isDangerousAssetFile(input.filename, mimeType) ||
      !isAllowedAssetMimeType(mimeType, normalizedAllowedMimeTypes)
    ) {
      throw new Error(buildUploadTypeBlockedMessage(mimeType))
    }

    if (estimateDecodedSize(input.contentBase64) > maxUploadBytes) {
      throw new Error(buildUploadTooLargeMessage(maxUploadBytes))
    }

    const originalBytes = bytesFromBase64(input.contentBase64)
    if (originalBytes.byteLength > maxUploadBytes) {
      throw new Error(buildUploadTooLargeMessage(maxUploadBytes))
    }

    await r2.put(originalKey, originalBytes, {
      httpMetadata: { contentType: mimeType },
    })

    const isImage = mimeType.startsWith('image/')

    const inferredWidth =
      input.width ??
      input.variants?.reduce<number | undefined>(
        (max, variant) => (variant.width && (max === undefined || variant.width > max) ? variant.width : max),
        undefined
      )
    const inferredHeight =
      input.height ??
      input.variants?.reduce<number | undefined>(
        (max, variant) => (variant.height && (max === undefined || variant.height > max) ? variant.height : max),
        undefined
      )

    const storedWidth = inferredWidth ?? null
    const storedHeight = inferredHeight ?? null
    const storedBlurhash = input.blurhash ?? null

    const asset = await assetsRepository.createAsset(db, {
      id: assetId,
      tenantId: tenantScope,
      filename: input.filename,
      mimeType,
      size: originalBytes.byteLength,
      width: storedWidth,
      height: storedHeight,
      blurhash: storedBlurhash,
      createdBy: createdBy ?? null,
      originalKey,
      createdAt: now,
      updatedAt: now,
    })

    const variantRows: Array<{
      id: string
      assetId: string
      variant: string
      format: string
      width: number | null
      height: number | null
      fileSize: number
      objectKey: string
      createdAt: string
      bytes: Uint8Array
    }> = []

    for (const variant of input.variants ?? []) {
      if (!isImage || !variant.contentBase64) continue
      const objectKey = buildVariantKey(tenantScope, assetId, variant.variant, variant.format)
      const variantBytes = bytesFromBase64(variant.contentBase64)
      const width = variant.width ?? null
      const height = variant.height ?? null

      variantRows.push({
        id: crypto.randomUUID(),
        assetId,
        variant: variant.variant,
        format: variant.format,
        width,
        height,
        fileSize: variantBytes.byteLength,
        objectKey,
        createdAt: now,
        bytes: variantBytes,
      })
    }

    await runInChunks(variantRows, 10, (variant) =>
      r2.put(variant.objectKey, variant.bytes, {
        httpMetadata: {
          contentType: variant.format === 'original' ? mimeType : `image/${variant.format}`,
        },
      })
    )

    await assetsRepository.createVariants(
      db,
      variantRows.map(({ bytes: _bytes, ...row }) => row)
    )

    const createdAsset = await assetsRepository.findById(db, asset.id, tenantScope)

    if (createdAsset && workerEnv) {
      scheduleAssetVectorWork(
        indexAssetVector(workerEnv, createdAsset, tenantScope).catch((error) => {
          logger.warn('asset_vector_index_failed', {
            assetId,
            tenantId: tenantScope,
            error: error instanceof Error ? error.message : String(error),
          })
        }),
        defer
      )
    }

    return createdAsset
  },

  async list(db: Database, tenantId?: string) {
    return assetsRepository.findAll(db, tenantId)
  },

  async usage(db: Database, tenantId?: string) {
    if (tenantId) {
      return [await assetsRepository.summarizeUsage(db, tenantId)]
    }
    return assetsRepository.summarizeUsageByTenant(db)
  },

  async getById(db: Database, id: string, tenantId?: string) {
    return assetsRepository.findById(db, id, tenantId)
  },

  async updateFilename(
    db: Database,
    id: string,
    filename: string,
    tenantId?: string,
    workerEnv?: Env,
    defer?: DeferAssetVectorWork
  ) {
    const tenantScope = tenantId ?? 'global'
    const normalized = filename
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join('/')

    if (!normalized) {
      return null
    }

    const updatedAsset = await assetsRepository.updateFilename(db, id, normalized, tenantScope)
    if (updatedAsset && workerEnv) {
      scheduleAssetVectorWork(
        indexAssetVector(workerEnv, updatedAsset, tenantScope).catch((error) => {
          logger.warn('asset_vector_reindex_failed', {
            id,
            tenantId: tenantScope,
            error: error instanceof Error ? error.message : String(error),
          })
        }),
        defer
      )
    }

    return updatedAsset
  },

  async softDelete(
    db: Database,
    r2: R2Bucket,
    id: string,
    tenantId?: string,
    workerEnv?: Env,
    defer?: DeferAssetVectorWork
  ) {
    return this.deleteMany(db, r2, [id], tenantId, workerEnv, defer)
  },

  async deleteMany(
    db: Database,
    _r2: R2Bucket,
    ids: string[],
    tenantId?: string,
    workerEnv?: Env,
    defer?: DeferAssetVectorWork
  ) {
    const tenantScope = tenantId ?? 'global'
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
    if (uniqueIds.length === 0) {
      return { deletedIds: [] as string[] }
    }

    const existingAssets = await assetsRepository.findByIds(db, uniqueIds, tenantScope)
    const deletedIds = await assetsRepository.softDeleteByIds(
      db,
      existingAssets.map((asset) => asset.id),
      tenantScope
    )

    if (deletedIds.length > 0 && workerEnv) {
      scheduleAssetVectorWork(
        removeAssetVectors(workerEnv, deletedIds, tenantScope).catch((error) => {
          logger.warn('asset_vector_delete_failed', {
            tenantId: tenantScope,
            count: deletedIds.length,
            error: error instanceof Error ? error.message : String(error),
          })
        }),
        defer
      )
    }

    return { deletedIds }
  },

  async semanticSearch(
    db: Database,
    input: SemanticAssetSearchInput,
    tenantId?: string,
    workerEnv?: Env
  ): Promise<Array<AssetWithVariants & { semanticScore?: number }>> {
    const tenantScope = tenantId ?? 'global'
    const query = input.query.trim()
    if (!query) {
      return []
    }

    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
    const vectorMatches =
      workerEnv && query.length > 1
        ? await searchAssetVectorIds(
            workerEnv,
            { query, topK: Math.max(limit * 2, 20) },
            tenantScope
          ).catch((error) => {
            logger.warn('vector_search_fallback_to_lexical', {
              tenantId: tenantScope,
              error: error instanceof Error ? error.message : String(error),
            })
            return []
          })
        : []

    const matchedIds = vectorMatches.map((match) => match.id.split(':').pop() ?? '').filter(Boolean)
    const scoreByAssetId = new Map(
      vectorMatches
        .map((match) => {
          const assetId = match.id.split(':').pop() ?? ''
          return assetId ? [assetId, match.score] : null
        })
        .filter((entry): entry is [string, number | undefined] => Boolean(entry))
    )

    const vectorAssets =
      matchedIds.length > 0 ? await assetsRepository.findByIds(db, matchedIds, tenantScope) : []

    const folderPrefix = input.folder ? `${input.folder}/` : undefined
    const vectorFiltered = vectorAssets.filter((asset) => {
      if (folderPrefix && !asset.filename.startsWith(folderPrefix)) {
        return false
      }
      if (input.mimeTypePrefix && !asset.mimeType.startsWith(input.mimeTypePrefix)) {
        return false
      }
      return true
    })

    if (vectorFiltered.length >= limit) {
      return vectorFiltered.slice(0, limit).map((asset) => ({
        ...asset,
        semanticScore: scoreByAssetId.get(asset.id),
      }))
    }

    const lexicalFallback = await assetsRepository.searchByTerm(db, {
      term: query,
      limit: limit * 2,
      folder: input.folder,
      mimeTypePrefix: input.mimeTypePrefix,
      tenantId: tenantScope,
    })

    const combined = [...vectorFiltered]
    const seenIds = new Set(combined.map((asset) => asset.id))
    for (const candidate of lexicalFallback) {
      if (!seenIds.has(candidate.id)) {
        combined.push(candidate)
        seenIds.add(candidate.id)
      }
      if (combined.length >= limit) {
        break
      }
    }

    return combined.slice(0, limit).map((asset) => ({
      ...asset,
      semanticScore: scoreByAssetId.get(asset.id),
    }))
  },

  async getPublicVariant(
    db: Database,
    r2: R2Bucket,
    id: string,
    variant: string,
    format: string,
    tenantId?: string
  ) {
    const tenantScope = tenantId ?? 'global'
    const assetVariant = await assetsRepository.findVariant(db, id, variant, format, tenantScope)
    if (!assetVariant) {
      return null
    }

    const object = await r2.get(assetVariant.objectKey)
    if (!object) {
      return null
    }

    return {
      object,
      variant: assetVariant,
    }
  },

  async resolvePublicVariant(
    db: Database,
    id: string,
    variant: string,
    accept: string | null,
    tenantId?: string
  ): Promise<
    | { success: true; data: { key: string; contentType: string } }
    | { success: false; error: { message: string } }
  > {
    const asset = await assetsRepository.findById(db, id, tenantId)
    if (!asset) {
      return { success: false, error: { message: 'Asset not found' } }
    }

    const prefersAvif = (accept ?? '').includes('image/avif')
    const prefersWebp = (accept ?? '').includes('image/webp')
    const preferredFormats = prefersAvif
      ? (['avif', 'webp'] as const)
      : prefersWebp
        ? (['webp'] as const)
        : ([] as const)

    for (const format of preferredFormats) {
      const matched = asset.variants.find((row) => row.variant === variant && row.format === format)
      if (matched) {
        return {
          success: true,
          data: {
            key: matched.objectKey,
            contentType: `image/${matched.format}`,
          },
        }
      }
    }

    return {
      success: true,
      data: {
        key: asset.originalKey,
        contentType: asset.mimeType,
      },
    }
  },
}
