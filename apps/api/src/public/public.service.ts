import { assetsService } from '@/assets/assets.service'
import { CacheMetadataTracker } from '@/cache/cache-metadata'
import { kvService } from '@/cache/kv.service'
import { snapshotService } from '@/cache/snapshot.service'
import type { CollectionRow } from '@/collections/collections.repository'
import type { Database } from '@/database/db'
import { computeDynamicTTL } from '@/scheduling/ttl.service'
import type { ParsedFilter, ParsedSort } from '@/public/query-filter'

import { buildDrizzleConditions, buildSortClause, enforceSearchAllowlist, hashFilterParams } from '@/public/query-filter'
import { scheduleDeferredWork } from '@/commands/deferred-work'
import { publicRepository } from './public.repository'

const DEFAULT_BROWSER_TTL = 60
const DEFAULT_CDN_TTL = 300

type EmbeddedSnapshotTtls = {
  dynamicTTL: number
  browserTTL: number
  cdnTTL: number
}

function toHeaderTtls(dynamicTTL: number): { browserTTL: number; cdnTTL: number } {
  return {
    browserTTL: Math.min(dynamicTTL, DEFAULT_BROWSER_TTL),
    cdnTTL: Math.min(dynamicTTL, DEFAULT_CDN_TTL),
  }
}

function readEmbeddedHeaderTtls(stored: unknown): { browserTTL: number; cdnTTL: number } {
  const cache =
    typeof stored === 'object' && stored !== null
      ? (stored as { cache?: unknown }).cache
      : undefined
  if (
    typeof cache === 'object' &&
    cache !== null &&
    typeof (cache as EmbeddedSnapshotTtls).browserTTL === 'number' &&
    typeof (cache as EmbeddedSnapshotTtls).cdnTTL === 'number'
  ) {
    return {
      browserTTL: (cache as EmbeddedSnapshotTtls).browserTTL,
      cdnTTL: (cache as EmbeddedSnapshotTtls).cdnTTL,
    }
  }
  return { browserTTL: DEFAULT_BROWSER_TTL, cdnTTL: DEFAULT_CDN_TTL }
}

function withEmbeddedTtls<T extends object>(
  snapshot: T,
  ttls: EmbeddedSnapshotTtls
): T & { cache: EmbeddedSnapshotTtls } {
  return { ...snapshot, cache: ttls }
}

function stripEmbeddedTtls<T>(stored: T): T {
  if (typeof stored === 'object' && stored !== null && 'cache' in stored) {
    const copy = { ...(stored as Record<string, unknown>) }
    delete copy.cache
    return copy as T
  }
  return stored
}

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

type PublicSnapshotResult = PublicResult<{ payload: unknown; cache: PublicCacheMeta }>

// Singleflight: concurrent requests for the same versioned snapshot share one
// generation pipeline instead of stampeding D1 + KV writes.
const inflightSnapshotRequests = new Map<string, Promise<PublicSnapshotResult>>()

function dedupeSnapshotRequest(
  key: string,
  factory: () => Promise<PublicSnapshotResult>
): Promise<PublicSnapshotResult> {
  const existing = inflightSnapshotRequests.get(key)
  if (existing) return existing
  const pending = factory().finally(() => {
    if (inflightSnapshotRequests.get(key) === pending) inflightSnapshotRequests.delete(key)
  })
  inflightSnapshotRequests.set(key, pending)
  return pending
}

// TODO(perf): no persistent negative cache for 404s. Miss results depend on D1
// state (collection/entry visibility, tenant scope) keyed by tenant + version,
// so caching them risks stale 404s; singleflight above already dedupes
// concurrent misses. Revisit with a short (≤10s) TTL negative cache if 404
// volume becomes a problem.

export function buildPublicCacheTag(
  collection: { id?: string; slug: string },
  locale: string,
  tenantId?: string,
  idOrSlug?: string
): string {
  const tags: string[] = []
  if (tenantId) {
    if (collection.id) {
      tags.push(`t:${tenantId}:c:${collection.id}`)
    }
    tags.push(`t:${tenantId}:c:${collection.slug}`)
  }
  tags.push(`collection:${collection.slug}`)
  tags.push(`locale:${locale}`)
  if (idOrSlug) {
    tags.push(`entry:${idOrSlug}`)
  }
  return tags.join(',')
}

function buildCachedPublicResult(
  stored: unknown,
  cacheTag: string,
  tracker: CacheMetadataTracker
): PublicSnapshotResult {
  if (tracker.getStatus() === 'MISS') {
    tracker.recordHit('kv')
  }
  // Reuse the TTLs embedded at write time so hit/miss Cache-Control headers
  // agree — no D1 recompute on the hot path.
  const { browserTTL, cdnTTL } = readEmbeddedHeaderTtls(stored)
  return {
    success: true,
    data: {
      payload: stripEmbeddedTtls(stored),
      cache: {
        cacheTag,
        browserTTL,
        cdnTTL,
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

function parseRangeHeader(
  rangeHeader: string,
  total: number
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null
  const [, startStr, endStr] = match
  if (!startStr && !endStr) return null
  if (!startStr) {
    const suffix = Number.parseInt(endStr as string, 10)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    if (suffix >= total) return { start: 0, end: total - 1 }
    return { start: total - suffix, end: total - 1 }
  }
  const start = Number.parseInt(startStr as string, 10)
  if (!Number.isFinite(start) || start < 0 || start >= total) return null
  if (!endStr) return { start, end: total - 1 }
  const end = Number.parseInt(endStr as string, 10)
  if (!Number.isFinite(end) || end < start) return null
  return { start, end: Math.min(end, total - 1) }
}

type CollectionResolver = () => Promise<CollectionRow | null | undefined>

/**
 * Collection lookup for the snapshot miss path. Order: an explicitly
 * preloaded row (null = known missing), then a caller-supplied memoized
 * resolver, then a direct repository query.
 */
async function loadCollectionForMiss(
  db: Database,
  collectionSlug: string,
  tenantId: string | undefined,
  preloadedCollection: CollectionRow | null | undefined,
  resolveCollection: CollectionResolver | undefined
): Promise<CollectionRow | null | undefined> {
  if (preloadedCollection !== undefined) return preloadedCollection
  if (resolveCollection) return resolveCollection()
  return publicRepository.findCollectionBySlug(db, collectionSlug, tenantId)
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
    rangeHeader?: string | null
  }): Promise<PublicResult<Response>> {
    const { db, r2, assetId, variantParam, accept, tenantId, transform, requestUrl, isRaw, rangeHeader } = params
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
          edgeHeaders.set('Vary', 'Accept')
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
    let objectKey = resolved.data.key
    if (!object && resolved.data.fallbackKey !== resolved.data.key) {
      // Single-DB-call fallback: reuse originalKey from the first resolve (no second query).
      object = await r2.get(resolved.data.fallbackKey)
      contentType = resolved.data.fallbackContentType
      objectKey = resolved.data.fallbackKey
    }
    if (!object) {
      return { success: false, error: { status: 404, message: 'Asset variant not found' } }
    }

    const headers: Record<string, string> = {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'CDN-Cache-Control': 'public, max-age=31536000',
      'Vary': 'Accept',
      'Content-Type':
        transform?.format && transform.format !== 'auto'
          ? `image/${transform.format}`
          : contentType,
      'x-edgecms-cache': 'hit',
      'x-image-transform': hasTransform ? 'fallback' : 'none',
      'Accept-Ranges': 'bytes',
    }
    if (hasTransform) {
      headers['x-image-transform-params'] = JSON.stringify(transform)
    }

    // R2 Range requests: serve partial content with 206 when the client
    // sends `Range: bytes=start-end` and the object size is known.
    // Range + transform is not combined — transforms return full bodies above.
    if (rangeHeader && !hasTransform) {
      const total = (object as unknown as { size?: unknown }).size
      if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
        const range = parseRangeHeader(rangeHeader, total)
        if (range) {
          const ranged = await r2.get(objectKey, {
            range: { offset: range.start, length: range.end - range.start + 1 },
          })
          const body = (ranged as unknown as { body?: unknown } | null)?.body
          if (ranged && body !== undefined) {
            const rangedSize = (ranged as unknown as { size?: unknown }).size
            return {
              success: true,
              data: new Response(ranged.body as unknown as typeof object.body, {
                status: 206,
                headers: {
                  ...headers,
                  'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
                  'Content-Length': String(
                    typeof rangedSize === 'number' ? rangedSize : range.end - range.start + 1
                  ),
                },
              }),
            }
          }
        }
      }
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
    preloadedCollection?: CollectionRow | null
    /** Memoized lookup used only on a snapshot miss (no D1 on cache hits). */
    resolveCollection?: CollectionResolver
    waitUntil?: unknown
  }): Promise<PublicSnapshotResult> {
    const {
      db,
      kv,
      collectionSlug,
      locale,
      page,
      perPage,
      tenantId,
      filters = [],
      sort,
      preloadedCollection,
      resolveCollection,
      waitUntil,
    } = params
    const filterHash = hashFilterParams(filters, sort ?? [])
    const tracker = new CacheMetadataTracker()
    const baseKey = `snapshot:${collectionSlug}:${locale}:list:${page}:${perPage}:${filterHash}`
    const version = await kvService.getCurrentVersion(kv, collectionSlug, locale, tenantId)
    const versionedKey = kvService.getVersionedKey(baseKey, version, tenantId)

    const snapshot = await kvService.getSnapshot(kv, versionedKey, tracker)
    const effectiveTenantId = tenantId ?? (snapshot as { tenantId?: string } | null)?.tenantId
    const snapshotCol = (snapshot as { collection?: { id?: string; slug: string } } | null)?.collection
    const hitCacheTag = buildPublicCacheTag(
      snapshotCol ?? { slug: collectionSlug },
      locale,
      effectiveTenantId
    )
    if (snapshot) {
      return buildCachedPublicResult(snapshot, hitCacheTag, tracker)
    }

    const collection = await loadCollectionForMiss(
      db,
      collectionSlug,
      tenantId,
      preloadedCollection,
      resolveCollection
    )
    if (!collection) {
      return { success: false, error: { status: 404, message: 'Collection not found' } }
    }

    const cacheTag = buildPublicCacheTag(collection, locale, tenantId)

    return dedupeSnapshotRequest(versionedKey, async () => {
      // Enforce the collection's searchFields allowlist on expensive shapes
      // (contains LIKE scans, JSON sorts). Runs on the miss path only, after
      // the collection load — KV hits stay at zero D1.
      const gated = enforceSearchAllowlist(filters, sort ?? [], collection.searchFields ?? null)
      if (gated.errors.length > 0) {
        return {
          success: false,
          error: { status: 400, message: `Invalid filter parameters: ${gated.errors.join('; ')}` },
        }
      }
      const extraConditions = buildDrizzleConditions(gated.filters)
      const orderByClause = buildSortClause(gated.sort)

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
      const { browserTTL, cdnTTL } = toHeaderTtls(dynamicTTL)
      const tags = tenantId
        ? snapshotService.generateCacheTags(collection.id, undefined, locale, {
            tenantId,
            collectionSlug: collection.slug,
          })
        : snapshotService.generateCacheTags(collection.id, undefined, locale)
      await kvService.putSnapshot(
        kv,
        versionedKey,
        withEmbeddedTtls(generatedSnapshot, { dynamicTTL, browserTTL, cdnTTL }),
        dynamicTTL
      )
      scheduleDeferredWork(
        waitUntil,
        Promise.resolve(snapshotService.storeCacheTags(db, versionedKey, tags)),
        'public_store_cache_tags'
      )

      return {
        success: true,
        data: {
          payload: generatedSnapshot,
          cache: {
            cacheTag,
            browserTTL,
            cdnTTL,
            debugHeaders: tracker.toHeaders(),
          },
        },
      }
    })
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
    preloadedCollection?: CollectionRow | null
    waitUntil?: unknown
  }): Promise<PublicSnapshotResult> {
    const {
      db,
      kv,
      collectionSlug,
      idOrSlug,
      locale,
      populateParam,
      depth,
      tenantId,
      preloadedCollection,
      waitUntil,
    } = params
    const tracker = new CacheMetadataTracker()
    const { cacheToken, fieldNames } = normalizePopulateQuery(populateParam)
    const normalizedDepth = Math.min(Math.max(depth, 1), 3)
    const baseKey = `snapshot:${collectionSlug}:${locale}:entry:${idOrSlug}:${cacheToken}:${normalizedDepth}`
    const version = await kvService.getCurrentVersion(kv, collectionSlug, locale, tenantId)
    const versionedKey = kvService.getVersionedKey(baseKey, version, tenantId)

    const snapshot = await kvService.getSnapshot(kv, versionedKey, tracker)
    const effectiveTenantId = tenantId ?? (snapshot as { tenantId?: string } | null)?.tenantId
    const snapshotCol = (snapshot as { collection?: { id?: string; slug: string } } | null)?.collection
    const hitCacheTag = buildPublicCacheTag(
      snapshotCol ?? { slug: collectionSlug },
      locale,
      effectiveTenantId,
      idOrSlug
    )
    if (snapshot) {
      return buildCachedPublicResult(snapshot, hitCacheTag, tracker)
    }

    const collection = await loadCollectionForMiss(
      db,
      collectionSlug,
      tenantId,
      preloadedCollection,
      undefined
    )
    if (!collection) {
      return { success: false, error: { status: 404, message: 'Collection not found' } }
    }

    const cacheTag = buildPublicCacheTag(collection, locale, tenantId, idOrSlug)

    return dedupeSnapshotRequest(versionedKey, async () => {
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
      const { browserTTL, cdnTTL } = toHeaderTtls(dynamicTTL)
      const tags = tenantId
        ? snapshotService.generateCacheTags(
            collection.id,
            generatedSnapshot.entry.id,
            locale,
            { tenantId, collectionSlug: collection.slug }
          )
        : snapshotService.generateCacheTags(
            collection.id,
            generatedSnapshot.entry.id,
            locale
          )
      await kvService.putSnapshot(
        kv,
        versionedKey,
        withEmbeddedTtls(generatedSnapshot, { dynamicTTL, browserTTL, cdnTTL }),
        dynamicTTL
      )
      scheduleDeferredWork(
        waitUntil,
        Promise.resolve(snapshotService.storeCacheTags(db, versionedKey, tags)),
        'public_store_cache_tags'
      )

      return {
        success: true,
        data: {
          payload: generatedSnapshot,
          cache: {
            cacheTag,
            browserTTL,
            cdnTTL,
            debugHeaders: tracker.toHeaders(),
          },
        },
      }
    })
  },

  async getSingletonEntry(params: {
    db: Database
    kv: KVNamespace
    collectionSlug: string
    locale: string
    tenantId?: string
    preloadedCollection?: CollectionRow | null
    /** Memoized lookup used only on a snapshot miss (no D1 on cache hits). */
    resolveCollection?: CollectionResolver
    waitUntil?: unknown
  }): Promise<PublicSnapshotResult> {
    const {
      db,
      kv,
      collectionSlug,
      locale,
      tenantId,
      preloadedCollection,
      resolveCollection,
      waitUntil,
    } = params
    const tracker = new CacheMetadataTracker()
    const baseKey = `snapshot:${collectionSlug}:${locale}:singleton`
    const version = await kvService.getCurrentVersion(kv, collectionSlug, locale, tenantId)
    const versionedKey = kvService.getVersionedKey(baseKey, version, tenantId)

    const snapshot = await kvService.getSnapshot(kv, versionedKey, tracker)
    const effectiveTenantId = tenantId ?? (snapshot as { tenantId?: string } | null)?.tenantId
    const snapshotCol = (snapshot as { collection?: { id?: string; slug: string } } | null)?.collection
    const hitCacheTag = buildPublicCacheTag(
      snapshotCol ?? { slug: collectionSlug },
      locale,
      effectiveTenantId
    )
    if (snapshot) {
      return buildCachedPublicResult(snapshot, hitCacheTag, tracker)
    }

    const collection = await loadCollectionForMiss(
      db,
      collectionSlug,
      tenantId,
      preloadedCollection,
      resolveCollection
    )
    if (!collection) {
      return { success: false, error: { status: 404, message: 'Collection not found' } }
    }

    if (!collection.singleton) {
      return { success: false, error: { status: 400, message: 'Collection is not a singleton' } }
    }

    const cacheTag = buildPublicCacheTag(collection, locale, tenantId)

    return dedupeSnapshotRequest(versionedKey, async () => {
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
      const { browserTTL, cdnTTL } = toHeaderTtls(dynamicTTL)
      const tags = tenantId
        ? snapshotService.generateCacheTags(collection.id, entry.id, locale, {
            tenantId,
            collectionSlug: collection.slug,
          })
        : snapshotService.generateCacheTags(collection.id, entry.id, locale)
      await kvService.putSnapshot(
        kv,
        versionedKey,
        withEmbeddedTtls(generatedSnapshot, { dynamicTTL, browserTTL, cdnTTL }),
        dynamicTTL
      )
      scheduleDeferredWork(
        waitUntil,
        Promise.resolve(snapshotService.storeCacheTags(db, versionedKey, tags)),
        'public_store_cache_tags'
      )

      return {
        success: true,
        data: {
          payload: generatedSnapshot,
          cache: {
            cacheTag,
            browserTTL,
            cdnTTL,
            debugHeaders: tracker.toHeaders(),
          },
        },
      }
    })
  },
}
