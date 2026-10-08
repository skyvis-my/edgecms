import { assetsService } from '@/assets/assets.service'
import { CacheMetadataTracker } from '@/cache/cache-metadata'
import { kvService } from '@/cache/kv.service'
import { snapshotService } from '@/cache/snapshot.service'
import type { Database } from '@/database/db'
import { computeDynamicTTL } from '@/scheduling/ttl.service'
import type { ParsedFilter, ParsedSort } from '@/public/query-filter'

import { buildDrizzleConditions, buildSortClause, hashFilterParams } from '@/public/query-filter'
import { publicRepository } from './public.repository'

export type PublicCacheMeta = {
  cacheTag: string
  browserTTL: number
  cdnTTL: number
  debugHeaders: Record<string, string>
}

type PublicError = {
  status: number
  message: string
}

type PublicResult<T> = { success: true; data: T } | { success: false; error: PublicError }

async function resolveCacheHeaderTtls(db: Database, collectionId: string | undefined) {
  if (!collectionId) {
    return { browserTTL: 60, cdnTTL: 300 }
  }

  const [browserTTL, cdnTTL] = await Promise.all([
    computeDynamicTTL(db, collectionId, 60).then((ttl) => Math.min(ttl, 60)),
    computeDynamicTTL(db, collectionId, 300).then((ttl) => Math.min(ttl, 300)),
  ])

  return { browserTTL, cdnTTL }
}

function buildCachedPublicResult(
  payload: unknown,
  cacheTag: string,
  tracker: CacheMetadataTracker
): PublicResult<{ payload: unknown; cache: PublicCacheMeta }> {
  if (tracker.getStatus() === 'MISS') {
    tracker.recordHit('kv')
  }
  return {
    success: true,
    data: {
      payload,
      cache: {
        cacheTag,
        browserTTL: 60,
        cdnTTL: 300,
        debugHeaders: tracker.toHeaders(),
      },
    },
  }
}

function resolveVariantParam(variantParam: string): string {
  return variantParam.includes('.') ? (variantParam.split('.')[0] ?? variantParam) : variantParam
}

function normalizePopulateQuery(populateParam: string): { cacheToken: string; fieldNames: string[] } {
  const trimmed = populateParam.trim()
  if (!trimmed) {
    return { cacheToken: 'none', fieldNames: [] }
  }

  if (trimmed === '*') {
    return { cacheToken: '*', fieldNames: ['*'] }
  }

  const fieldNames = Array.from(
    new Set(
      trimmed
        .split(',')
        .map((field) => field.trim())
        .filter((field) => field.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b))

  if (fieldNames.length === 0) {
    return { cacheToken: 'none', fieldNames: [] }
  }

  return { cacheToken: fieldNames.join(','), fieldNames }
}

export type ImageTransformOptions = {
  width?: number
  height?: number
  fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad'
  format?: 'auto' | 'webp' | 'avif' | 'jpeg' | 'png' | 'json'
}

export const publicService = {
  async getAssetVariant(params: {
    db: Database
    r2: R2Bucket
    assetId: string
    variantParam: string
    accept: string | null
    tenantId?: string
    transform?: ImageTransformOptions
    requestUrl?: string
    isRaw?: boolean
  }): Promise<PublicResult<Response>> {
    const { db, r2, assetId, variantParam, accept, tenantId, transform, requestUrl, isRaw } = params
    const variant = resolveVariantParam(variantParam)

    const hasTransform = Boolean(
      transform &&
        (transform.width || transform.height || transform.fit || transform.format)
    )

    // When deployed on Cloudflare Workers, route through Cloudflare edge image transforms.
    // Use isRaw guard and strip transform search params to avoid infinite subrequest recursion.
    if (hasTransform && requestUrl && !isRaw) {
      try {
        const rawUrl = new URL(requestUrl)
        rawUrl.searchParams.delete('w')
        rawUrl.searchParams.delete('width')
        rawUrl.searchParams.delete('h')
        rawUrl.searchParams.delete('height')
        rawUrl.searchParams.delete('fit')
        rawUrl.searchParams.delete('format')
        rawUrl.searchParams.delete('f')

        const edgeRes = await fetch(rawUrl.toString(), {
          headers: {
            'x-edgecms-raw-image': '1',
          },
          cf: {
            image: {
              width: transform?.width,
              height: transform?.height,
              fit: transform?.fit,
              format: transform?.format || 'auto',
            },
          } as unknown as RequestInitCfProperties,
        })
        if (edgeRes.ok) {
          const edgeHeaders = new Headers(edgeRes.headers)
          edgeHeaders.set('x-edgecms-cache', 'hit')
          edgeHeaders.set('x-image-transform', 'cf-edge')
          return {
            success: true,
            data: new Response(edgeRes.body, {
              status: edgeRes.status,
              headers: edgeHeaders,
            }),
          }
        }
      } catch {
        // Fall back to raw R2 object bytes in local miniflare or test environments
      }
    }

    const resolved = await assetsService.resolvePublicVariant(
      db,
      assetId,
      variant,
      accept,
      tenantId
    )
    if (!resolved.success) {
      return { success: false, error: { status: 404, message: resolved.error.message } }
    }

    let object = await r2.get(resolved.data.key)
    let contentType = resolved.data.contentType
    if (!object) {
      const original = await assetsService.resolvePublicVariant(db, assetId, variant, null, tenantId)
      if (original.success && original.data.key !== resolved.data.key) {
        object = await r2.get(original.data.key)
        contentType = original.data.contentType
      }
    }
    if (!object) {
      return { success: false, error: { status: 404, message: 'Asset variant not found' } }
    }

    const headers: Record<string, string> = {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'CDN-Cache-Control': 'public, max-age=31536000',
      'Content-Type':
        transform?.format && transform.format !== 'auto'
          ? `image/${transform.format}`
          : contentType,
      'x-edgecms-cache': 'hit',
      'x-image-transform': hasTransform ? 'fallback' : 'none',
    }
    if (hasTransform) {
      headers['x-image-transform-params'] = JSON.stringify(transform)
    }

    const response = new Response(object.body, { headers })

    return { success: true, data: response }
  },

  async getCollectionList(params: {
    db: Database
    kv: KVNamespace
    collectionSlug: string
    locale: string
    page: number
    perPage: number
    tenantId?: string
    filters?: ParsedFilter[]
    sort?: ParsedSort[]
  }): Promise<PublicResult<{ payload: unknown; cache: PublicCacheMeta }>> {
    const { db, kv, collectionSlug, locale, page, perPage, tenantId, filters = [], sort } = params
    const filterHash = hashFilterParams(filters, sort ?? [])
    const tracker = new CacheMetadataTracker()
    const baseKey = `snapshot:${collectionSlug}:${locale}:list:${page}:${perPage}:${filterHash}`
    const version = await kvService.getCurrentVersion(kv, collectionSlug, locale, tenantId)
    const versionedKey = kvService.getVersionedKey(baseKey, version, tenantId)

    let snapshot = await kvService.getSnapshot(kv, versionedKey, tracker)
    const cacheTag = `collection:${collectionSlug},locale:${locale}`
    if (snapshot) {
      return buildCachedPublicResult(snapshot, cacheTag, tracker)
    }

    const collection = await publicRepository.findCollectionBySlug(db, collectionSlug, tenantId)
    if (!collection) {
      return { success: false, error: { status: 404, message: 'Collection not found' } }
    }

    if (!snapshot) {
      const extraConditions = buildDrizzleConditions(filters)
      const orderByClause = buildSortClause(sort ?? [])

      const generatedSnapshot = await snapshotService.generateListSnapshot(
        db,
        collectionSlug,
        locale,
        tenantId,
        { page, perPage },
        { extraConditions, orderByClause },
        collection
      )

      if (!generatedSnapshot) {
        return { success: false, error: { status: 404, message: 'Collection not found' } }
      }

      const dynamicTTL = await computeDynamicTTL(db, collection.id, 3600)
      await kvService.putSnapshot(kv, versionedKey, generatedSnapshot, dynamicTTL)

      const tags = snapshotService.generateCacheTags(collection.id, undefined, locale)
      await snapshotService.storeCacheTags(db, versionedKey, tags)

      snapshot = generatedSnapshot
    }

    const { browserTTL, cdnTTL } = await resolveCacheHeaderTtls(db, collection.id)

    return {
      success: true,
      data: {
        payload: snapshot,
        cache: {
          cacheTag,
          browserTTL,
          cdnTTL,
          debugHeaders: tracker.toHeaders(),
        },
      },
    }
  },

  async getCollectionEntry(params: {
    db: Database
    kv: KVNamespace
    collectionSlug: string
    idOrSlug: string
    locale: string
    populateParam: string
    depth: number
    tenantId?: string
  }): Promise<PublicResult<{ payload: unknown; cache: PublicCacheMeta }>> {
    const { db, kv, collectionSlug, idOrSlug, locale, populateParam, depth, tenantId } = params
    const tracker = new CacheMetadataTracker()
    const { cacheToken, fieldNames } = normalizePopulateQuery(populateParam)
    const normalizedDepth = Math.min(Math.max(depth, 1), 3)
    const baseKey = `snapshot:${collectionSlug}:${locale}:entry:${idOrSlug}:${cacheToken}:${normalizedDepth}`
    const version = await kvService.getCurrentVersion(kv, collectionSlug, locale, tenantId)
    const versionedKey = kvService.getVersionedKey(baseKey, version, tenantId)

    let snapshot = await kvService.getSnapshot(kv, versionedKey, tracker)
    const cacheTag = `collection:${collectionSlug},locale:${locale},entry:${idOrSlug}`
    if (snapshot) {
      return buildCachedPublicResult(snapshot, cacheTag, tracker)
    }

    const collection = await publicRepository.findCollectionBySlug(db, collectionSlug, tenantId)
    if (!collection) {
      return { success: false, error: { status: 404, message: 'Collection not found' } }
    }

    if (!snapshot) {
      const generatedSnapshot = await snapshotService.generateEntrySnapshot(
        db,
        collectionSlug,
        idOrSlug,
        locale,
        tenantId,
        {
          populate: fieldNames,
          depth: normalizedDepth,
        },
        collection
      )

      if (!generatedSnapshot) {
        return {
          success: false,
          error: { status: 404, message: 'Entry not found or not published' },
        }
      }

      const dynamicTTL = await computeDynamicTTL(db, collection.id, 3600)
      await kvService.putSnapshot(kv, versionedKey, generatedSnapshot, dynamicTTL)

      const tags = snapshotService.generateCacheTags(
        collection.id,
        generatedSnapshot.entry.id,
        locale
      )
      await snapshotService.storeCacheTags(db, versionedKey, tags)

      snapshot = generatedSnapshot
    }

    const { browserTTL, cdnTTL } = await resolveCacheHeaderTtls(db, collection.id)

    return {
      success: true,
      data: {
        payload: snapshot,
        cache: {
          cacheTag,
          browserTTL,
          cdnTTL,
          debugHeaders: tracker.toHeaders(),
        },
      },
    }
  },

  async getSingletonEntry(params: {
    db: Database
    kv: KVNamespace
    collectionSlug: string
    locale: string
    tenantId?: string
  }): Promise<PublicResult<{ payload: unknown; cache: PublicCacheMeta }>> {
    const { db, kv, collectionSlug, locale, tenantId } = params
    const tracker = new CacheMetadataTracker()
    const baseKey = `snapshot:${collectionSlug}:${locale}:singleton`
    const version = await kvService.getCurrentVersion(kv, collectionSlug, locale, tenantId)
    const versionedKey = kvService.getVersionedKey(baseKey, version, tenantId)

    let snapshot = await kvService.getSnapshot(kv, versionedKey, tracker)
    const cacheTag = `collection:${collectionSlug},locale:${locale}`
    if (snapshot) {
      return buildCachedPublicResult(snapshot, cacheTag, tracker)
    }

    const collection = await publicRepository.findCollectionBySlug(db, collectionSlug, tenantId)
    if (!collection) {
      return { success: false, error: { status: 404, message: 'Collection not found' } }
    }

    if (!snapshot) {
      if (!collection.singleton) {
        return { success: false, error: { status: 400, message: 'Collection is not a singleton' } }
      }

      const entry = await publicRepository.findFirstVisibleEntryForCollection(db, collection.id)
      if (!entry) {
        return {
          success: false,
          error: { status: 404, message: 'No published entry found for singleton collection' },
        }
      }

      const generatedSnapshot = await snapshotService.generateEntrySnapshot(
        db,
        collectionSlug,
        entry.id,
        locale,
        tenantId,
        undefined,
        collection
      )
      if (!generatedSnapshot) {
        return { success: false, error: { status: 404, message: 'Failed to generate snapshot' } }
      }

      const dynamicTTL = await computeDynamicTTL(db, collection.id, 3600)
      await kvService.putSnapshot(kv, versionedKey, generatedSnapshot, dynamicTTL)

      const tags = snapshotService.generateCacheTags(collection.id, entry.id, locale)
      await snapshotService.storeCacheTags(db, versionedKey, tags)

      snapshot = generatedSnapshot
    }

    const { browserTTL, cdnTTL } = await resolveCacheHeaderTtls(db, collection.id)

    return {
      success: true,
      data: {
        payload: snapshot,
        cache: {
          cacheTag,
          browserTTL,
          cdnTTL,
          debugHeaders: tracker.toHeaders(),
        },
      },
    }
  },
}
