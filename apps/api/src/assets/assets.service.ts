import { eq } from 'drizzle-orm'
import { estimateDecodedSize, storedAssetBytes } from './storage-bytes'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { assets } from '@/database/schema/assets.schema'
import { r2GcRepository, sweepR2GcOutbox } from './r2-gc.repository'
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
  contentBase64?: string
  contentBytes?: Uint8Array
  width?: number
  height?: number
  blurhash?: string
  variants?: Array<{
    variant: string
    format: string
    width?: number
    height?: number
    contentBase64?: string
    contentBytes?: Uint8Array
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
  const failures: unknown[] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize)
    const results = await Promise.allSettled(chunk.map((item) => fn(item)))
    for (const r of results) {
      if (r.status === 'rejected') failures.push(r.reason)
    }
  }
  if (failures.length > 0) {
    throw failures[0] instanceof Error ? failures[0] : new Error(String(failures[0] ?? 'chunk failed'))
  }
}

function bytesFromBase64(base64: string): Uint8Array {
  const buf = Buffer.from(base64, 'base64')
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
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

    const estimatedSize = input.contentBytes
      ? input.contentBytes.byteLength
      : estimateDecodedSize(input.contentBase64 ?? '')
    if (estimatedSize > maxUploadBytes) {
      throw new Error(buildUploadTooLargeMessage(maxUploadBytes))
    }

    const originalBytes =
      input.contentBytes ?? (input.contentBase64 ? bytesFromBase64(input.contentBase64) : new Uint8Array(0))
    if (originalBytes.byteLength === 0 && !input.contentBytes && !input.contentBase64) {
      throw new Error('Upload payload requires asset content')
    }
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

    // ATM: compensating R2 rollback — if the D1 insert fails after the R2
    // put, delete the orphaned object instead of leaking storage.
    let asset
    try {
      asset = await assetsRepository.createAsset(db, {
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
    } catch (err) {
      await r2.delete(originalKey).catch((deleteErr) => {
        logger.warn('asset_orphan_cleanup_failed', {
          assetId,
          objectKey: originalKey,
          error: deleteErr instanceof Error ? deleteErr.message : String(deleteErr),
        })
      })
      throw err
    }

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
      const variantBytes =
        variant.contentBytes ?? (variant.contentBase64 ? bytesFromBase64(variant.contentBase64) : null)
      if (!isImage || !variantBytes) continue
      const objectKey = buildVariantKey(tenantScope, assetId, variant.variant, variant.format)
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

    const uploadedVariantKeys = variantRows.map((v) => v.objectKey)
    try {
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
    } catch (err) {
      // Compensate: remove variant objects (and the original) uploaded above,
      // plus the D1 asset row (otherwise it dangles at a deleted originalKey).
      await Promise.allSettled(
        [...uploadedVariantKeys, originalKey].map((key) => r2.delete(key))
      ).catch(() => undefined)
      await db.delete(assets).where(eq(assets.id, assetId)).catch(() => undefined)
      logger.warn('asset_variant_orphan_cleanup', {
        assetId,
        variantCount: uploadedVariantKeys.length,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }

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
      return { deletedIds: [] as string[], deletedBytes: 0 }
    }

    const existingAssets = await assetsRepository.findByIds(db, uniqueIds, tenantScope)
    // Soft-delete only marks rows (deletedAt); R2 objects are intentionally
    // retained so deletes stay reversible. Hard-delete paths enqueue R2 object
    // keys to the durable r2_gc_outbox table (see hardDelete / gcSoftDeleted).
    // DB delete below is tenant-scoped (tenantScope) so cross-tenant deletes are blocked.
    const deletedIds = await assetsRepository.softDeleteByIds(
      db,
      existingAssets.map((asset) => asset.id),
      tenantScope
    )
    // Bytes (original plus variants) no longer counted as stored (HS-05 metering).
    const deletedSet = new Set(deletedIds)
    const deletedBytes = existingAssets
      .filter((asset) => deletedSet.has(asset.id))
      .reduce((sum, asset) => sum + storedAssetBytes(asset), 0)

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

    return { deletedIds, deletedBytes }
  },

  async hardDelete(
    db: Database,
    r2: R2Bucket,
    ids: string[],
    tenantId?: string,
    workerEnv?: Env,
    defer?: DeferAssetVectorWork
  ): Promise<{ deletedIds: string[]; r2Failures: string[]; deletedBytes: number }> {
    const tenantScope = tenantId ?? 'global'
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
    if (uniqueIds.length === 0) {
      return { deletedIds: [], r2Failures: [], deletedBytes: 0 }
    }

    // Inclusion-aware fetch: soft-deleted rows (deletedAt set) are the
    // primary hard-delete targets, so findByIds (live-only) cannot be used.
    const existingAssets = await assetsRepository.findByIdsIncludingDeleted(
      db,
      uniqueIds,
      tenantScope
    )
    if (existingAssets.length === 0) {
      return { deletedIds: [], r2Failures: [], deletedBytes: 0 }
    }

    const keysById = new Map(
      existingAssets.map((asset) => [
        asset.id,
        [
          asset.originalKey,
          ...(asset.variants ?? []).map((variant) => variant.objectKey),
        ].filter((key): key is string => typeof key === 'string' && key.length > 0),
      ])
    )
    const deletedIds = await assetsRepository.deleteByIds(
      db,
      existingAssets.map((asset) => asset.id),
      tenantScope
    )
    const keysToDelete = deletedIds.flatMap((id) => keysById.get(id) ?? [])
    // Soft-deleted rows were already subtracted from stored bytes when deleted.
    const deletedSet = new Set(deletedIds)
    const deletedBytes = existingAssets
      .filter((asset) => deletedSet.has(asset.id) && !asset.deletedAt)
      .reduce((sum, asset) => sum + storedAssetBytes(asset), 0)

    // Durable path: enqueue every key BEFORE attempting R2 deletes so a crash
    // between DB commit and r2.delete never leaks objects — pending rows are
    // replayed by sweepR2GcOutbox (see gcSoftDeleted / POST /gc). Degrades to
    // direct best-effort deletes when the outbox table is unavailable.
    const r2Failures: string[] = []
    const durable = await r2GcRepository
      .enqueueKeys(db, tenantScope, keysToDelete)
      .catch(() => false)
    if (durable) {
      const outcomes = await Promise.allSettled(
        keysToDelete.map(async (key) => {
          try {
            await r2.delete(key)
            await r2GcRepository.markSentByKey(db, key)
          } catch (err) {
            await r2GcRepository.markFailedByKey(db, key)
            throw err
          }
        })
      )
      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'rejected') r2Failures.push(keysToDelete[index] as string)
      })
    } else {
      // Best-effort: DB rows are committed, so R2 failures are reported, not thrown.
      const outcomes = await Promise.allSettled(keysToDelete.map((key) => r2.delete(key)))
      keysToDelete.forEach((key, index) => {
        if (outcomes[index]?.status === 'rejected') r2Failures.push(key)
      })
    }
    if (r2Failures.length > 0) {
      logger.warn('asset_r2_cleanup_failed', {
        tenantId: tenantScope,
        count: r2Failures.length,
        objectKeys: r2Failures,
      })
    }

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

    return { deletedIds, r2Failures, deletedBytes }
  },

  async gcSoftDeleted(
    db: Database,
    r2: R2Bucket,
    input: { olderThanDays?: number; limit?: number; tenantId?: string } = {},
    workerEnv?: Env,
    defer?: DeferAssetVectorWork
  ): Promise<{ deletedIds: string[]; r2Failures: string[] }> {
    const olderThanDays = Math.min(365, Math.max(1, Math.floor(input.olderThanDays ?? 30) || 30))
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50) || 50))
    const cutoffIso = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()

    const stale = await assetsRepository.findSoftDeletedBefore(db, {
      cutoffIso,
      limit,
      tenantId: input.tenantId,
    })
    if (stale.length === 0) {
      return { deletedIds: [], r2Failures: [] }
    }

    // Group by tenant so each hardDelete stays tenant-scoped (no cross-tenant deletes).
    const idsByTenant = new Map<string, string[]>()
    for (const row of stale) {
      const scope = row.tenantId ?? input.tenantId ?? 'global'
      const current = idsByTenant.get(scope)
      if (current) current.push(row.id)
      else idsByTenant.set(scope, [row.id])
    }

    const deletedIds: string[] = []
    const r2Failures: string[] = []
    for (const [scope, scopeIds] of idsByTenant) {
      const result = await this.hardDelete(db, r2, scopeIds, scope, workerEnv, defer)
      deletedIds.push(...result.deletedIds)
      r2Failures.push(...result.r2Failures)
    }
    // Drain any backlog of pending R2 deletes (crash-replayed or previously
    // failed keys). Result shape is unchanged; swept counts are logged.
    const swept = await sweepR2GcOutbox(db, r2, { limit: 50 })
    if (swept.deleted > 0 || swept.failed > 0) {
      logger.warn('asset_gc_sweep_summary', {
        tenantId: input.tenantId ?? 'all',
        sweptDeleted: swept.deleted,
        sweptFailed: swept.failed,
      })
    }
    return { deletedIds, r2Failures }
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
    // Vector matches carry no folder/mime metadata, so folder/mimeTypePrefix
    // predicates cannot be pushed into the Vectorize query — they are applied
    // here in memory after the tenant-scoped findByIds. The lexical fallback
    // below pushes both predicates into the DB WHERE clause (searchByTerm).
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
    | { success: true; data: { key: string; contentType: string; fallbackKey: string; fallbackContentType: string } }
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
            fallbackKey: asset.originalKey,
            fallbackContentType: asset.mimeType,
          },
        }
      }
    }

    return {
      success: true,
      data: {
        key: asset.originalKey,
        contentType: asset.mimeType,
        fallbackKey: asset.originalKey,
        fallbackContentType: asset.mimeType,
      },
    }
  },
}
