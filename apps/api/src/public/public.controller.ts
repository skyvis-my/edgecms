import { Elysia, t } from 'elysia'
import { assetsService } from '@/assets/assets.service'
import { parsePublicFilters } from '@/public/query-filter'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { getRequestUrl } from '@/shared/utils/request-url'
import { publicService, type ImageTransformOptions } from './public.service'
import { publicRepository } from './public.repository'
import type { CollectionRow } from '@/collections/collections.repository'
import { generatePreviewToken, verifyPreviewToken } from './preview-token'
import { handleX402Gate } from './x402.middleware'

type CacheHeaders = Record<string, string | number | string[] | undefined>
const PUBLIC_STALE_WHILE_REVALIDATE_SECONDS = 300
const PUBLIC_CDN_STALE_WHILE_REVALIDATE_SECONDS = 3600
const PUBLIC_STALE_IF_ERROR_SECONDS = 86400

function parseImageTransformQuery(query: Record<string, string | undefined>): ImageTransformOptions {
  const w = query.w || query.width
  const h = query.h || query.height
  const fit = query.fit as ImageTransformOptions['fit']
  const format = (query.format || query.f) as ImageTransformOptions['format']

  const width = w ? Number.parseInt(w, 10) : undefined
  const height = h ? Number.parseInt(h, 10) : undefined

  return {
    width: width && !Number.isNaN(width) && width > 0 && width <= 4096 ? width : undefined,
    height: height && !Number.isNaN(height) && height > 0 && height <= 4096 ? height : undefined,
    fit: fit && ['scale-down', 'contain', 'cover', 'crop', 'pad'].includes(fit) ? fit : undefined,
    format:
      format && ['auto', 'webp', 'avif', 'jpeg', 'png', 'json'].includes(format) ? format : undefined,
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed) || parsed < 1) return fallback
  return parsed
}

function setPublicMissCache(headers: CacheHeaders) {
  headers['Cache-Control'] = 'no-store'
  headers['CDN-Cache-Control'] = 'no-store'
  headers['x-edgecms-cache'] = 'miss'
}

import { generateWeakETag } from './etag'
export { generateWeakETag }

function respondWithSnapshot(
  set: { status?: number | string; headers: CacheHeaders },
  cache: {
    cacheTag: string
    browserTTL: number
    cdnTTL: number
    debugHeaders?: Record<string, string>
    etag?: string
    rawJson?: string
  },
  payload: unknown,
  ifNoneMatch: string | null
): Response | unknown {
  const cacheTag = cache.cacheTag
  const etag = cache.etag ?? generateWeakETag(cacheTag, payload)
  if (isIfNoneMatch(ifNoneMatch, etag)) {
    setPublicCacheHeaders(
      set.headers,
      cacheTag,
      cache.browserTTL,
      cache.cdnTTL,
      cache.debugHeaders,
      etag
    )
    const responseHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(set.headers)) {
      if (v !== undefined) {
        responseHeaders[k] = String(v)
      }
    }
    return new Response(null, {
      status: 304,
      headers: responseHeaders,
    })
  }

  setPublicCacheHeaders(
    set.headers,
    cacheTag,
    cache.browserTTL,
    cache.cdnTTL,
    cache.debugHeaders,
    etag
  )

  if (cache.rawJson) {
    const responseHeaders: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
    }
    for (const [k, v] of Object.entries(set.headers)) {
      if (v !== undefined) {
        responseHeaders[k] = String(v)
      }
    }
    return new Response(cache.rawJson, {
      status: 200,
      headers: responseHeaders,
    })
  }

  return payload
}

export function isIfNoneMatch(headerValue: string | null | undefined, etag: string): boolean {
  if (!headerValue || !etag) return false
  const trimmed = headerValue.trim()
  if (trimmed === '*' || trimmed === 'W/"*"') return true
  const candidates = trimmed.split(',').map((c) => c.trim())
  const normalizedEtag = etag.replace(/^W\//, '').replace(/"/g, '')
  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate === '*' || candidate === 'W/"*"') return true
    const normalizedCandidate = candidate.replace(/^W\//, '').replace(/"/g, '')
    if (candidate === etag || normalizedCandidate === normalizedEtag) {
      return true
    }
  }
  return false
}

export function isIfRangeMatch(
  ifRangeHeader: string | null | undefined,
  etag: string | undefined
): boolean {
  if (!ifRangeHeader || !etag) return false
  const trimmed = ifRangeHeader.trim()
  // RFC 7233 §3.2: An entity-tag validator in If-Range MUST use strong comparison.
  // Weak entity-tags cannot be used with If-Range.
  if (trimmed.startsWith('W/') || etag.startsWith('W/')) return false
  const cleanIfRange = trimmed.replace(/^"/, '').replace(/"$/, '')
  const cleanEtag = etag.replace(/^"/, '').replace(/"$/, '')
  return cleanIfRange === cleanEtag
}

export function parseRangeHeader(
  rangeHeader: string,
  total: number
): { start: number; end: number } | null {
  if (total <= 0) return null
  const match = /^bytes\s*=\s*(\d*)\s*-\s*(\d*)$/.exec(rangeHeader.trim())
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

function setPublicCacheHeaders(
  headers: CacheHeaders,
  cacheTag: string,
  browserTTL: number,
  cdnTTL: number,
  debugHeaders?: Record<string, string>,
  etag?: string
) {
  headers['Cache-Control'] =
    `public, max-age=${browserTTL}, ` +
    `stale-while-revalidate=${PUBLIC_STALE_WHILE_REVALIDATE_SECONDS}, ` +
    `stale-if-error=${PUBLIC_STALE_IF_ERROR_SECONDS}`
  headers['CDN-Cache-Control'] =
    `public, max-age=${cdnTTL}, ` +
    `stale-while-revalidate=${PUBLIC_CDN_STALE_WHILE_REVALIDATE_SECONDS}, ` +
    `stale-if-error=${PUBLIC_STALE_IF_ERROR_SECONDS}`
  headers.Vary = 'Accept-Encoding'
  headers['Cache-Tag'] = cacheTag
  if (etag) {
    headers.ETag = etag
  }
  headers['x-edgecms-cache'] =
    debugHeaders?.['x-edgecms-cache'] ??
    (debugHeaders?.['X-Cache-Status'] ? debugHeaders['X-Cache-Status'].toLowerCase() : 'miss')
  if (debugHeaders) {
    for (const [key, value] of Object.entries(debugHeaders)) {
      headers[key] = value
    }
    const serverTiming = toServerTiming(debugHeaders)
    if (serverTiming) headers['Server-Timing'] = serverTiming
  }
}

/**
 * Standard `Server-Timing` view of the cache tracker headers, so clients and
 * benchmarks can separate in-Worker time from network time:
 * `cache;desc="memory";dur=1`.
 */
export function toServerTiming(debugHeaders: Record<string, string>): string | undefined {
  const source = debugHeaders['X-Cache-Source']
  const duration = Number.parseFloat(debugHeaders['X-Response-Time'] ?? '')
  if (!source || !Number.isFinite(duration)) return undefined
  return `cache;desc="${source.replace(/[^a-z]/gi, '')}";dur=${duration}`
}

export const publicController = new Elysia({ prefix: '/api/public', normalize: 'typebox' })
  .use(withTenantBindings)
  .get('/assets/:assetId/:variant/:format', {
    params: t.Object({
      assetId: t.String({ minLength: 1 }),
      variant: t.String({ minLength: 1 }),
      format: t.String({ minLength: 1 }),
    }),
  }, async (ctx) => {
    const { params, query, set, request, db, r2, tenantCtx } = ctx
    const result = await assetsService.getPublicVariant(
      db,
      r2,
      params.assetId,
      params.variant,
      params.format,
      tenantCtx?.tenant.id
    )

    if (!result) {
      const transform = parseImageTransformQuery(query as Record<string, string | undefined>)
      const fallback = await publicService.getAssetVariant({
        db,
        r2,
        assetId: params.assetId,
        variantParam: params.variant,
        accept: request.headers.get('accept'),
        tenantId: tenantCtx?.tenant.id,
        transform,
        requestUrl: request.url,
        rangeHeader: request.headers.get('range'),
        ifNoneMatch: request.headers.get('if-none-match'),
      })
      if (!fallback.success) {
        set.status = fallback.error.status
        setPublicMissCache(set.headers)
        return { error: fallback.error.message }
      }

      return fallback.data
    }

    const tenantScope = tenantCtx?.tenant.id || 'global'
    const etag = (result.object as unknown as { httpEtag?: string; etag?: string }).httpEtag ||
      (result.object as unknown as { httpEtag?: string; etag?: string }).etag
    const ifNoneMatch = request.headers.get('if-none-match')
    const rangeHeader = request.headers.get('range')

    const assetHeaders: Record<string, string> = {
      'Content-Type':
        result.object.httpMetadata?.contentType ?? `image/${params.format}`,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'CDN-Cache-Control': 'public, max-age=31536000',
      'Vary': 'Accept',
      'x-edgecms-cache': 'hit',
      'Accept-Ranges': 'bytes',
      'Cache-Tag': `t:${tenantScope}:a:${params.assetId}`,
    }
    if (etag) {
      assetHeaders.ETag = etag
    }

    if (etag && isIfNoneMatch(ifNoneMatch, etag)) {
      return new Response(null, {
        status: 304,
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'CDN-Cache-Control': 'public, max-age=31536000',
          'Vary': 'Accept',
          'Accept-Ranges': 'bytes',
          'Cache-Tag': `t:${tenantScope}:a:${params.assetId}`,
          ETag: etag,
        },
      })
    }

    if (rangeHeader) {
      const trimmedRange = rangeHeader.trim()
      // RFC 7233 §3.1: An origin server MUST ignore a Range header field that contains a range unit it does not understand.
      if (trimmedRange.startsWith('bytes=')) {
        // RFC 7233 §3.2: If-Range header evaluation
        const ifRange = request.headers.get('if-range')
        const isIfRangeSatisfied = !ifRange || !etag || isIfRangeMatch(ifRange, etag)

        if (isIfRangeSatisfied) {
          // Check for multipart ranges (comma-separated): ignore if multipart per RFC 7233 §3.1
          const byteRanges = trimmedRange.slice(6).split(',').map((s) => s.trim()).filter(Boolean)
          if (byteRanges.length === 1) {
            const total = (result.object as unknown as { size?: unknown }).size
            if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
              const range = parseRangeHeader(trimmedRange, total)
              if (range) {
                const ranged = await r2.get(result.variant.objectKey, {
                  range: { offset: range.start, length: range.end - range.start + 1 },
                })
                const body = (ranged as unknown as { body?: unknown } | null)?.body
                if (ranged && body !== undefined) {
                  const rangedSize = (ranged as unknown as { size?: unknown }).size
                  return new Response(ranged.body as unknown as typeof result.object.body, {
                    status: 206,
                    headers: {
                      ...assetHeaders,
                      'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
                      'Content-Length': String(
                        typeof rangedSize === 'number' ? rangedSize : range.end - range.start + 1
                      ),
                    },
                  })
                }
              } else {
                return new Response(null, {
                  status: 416,
                  headers: {
                    'Content-Range': `bytes */${total}`,
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                    'CDN-Cache-Control': 'public, max-age=31536000',
                    'Cache-Tag': `t:${tenantScope}:a:${params.assetId}`,
                    ...(etag ? { ETag: etag } : {}),
                  },
                })
              }
            }
          }
        }
      }
    }

    return new Response(result.object.body, {
      headers: assetHeaders,
    })
  })
  .get('/assets/:assetId/:variant', {
    params: t.Object({
      assetId: t.String({ minLength: 1 }),
      variant: t.String({ minLength: 1 }),
    }),
  }, async (ctx) => {
    const { params, query, set, request, db, r2, tenantCtx } = ctx
    const transform = parseImageTransformQuery(query as Record<string, string | undefined>)

    const result = await publicService.getAssetVariant({
      db,
      r2,
      assetId: params.assetId,
      variantParam: params.variant,
      accept: request.headers.get('accept'),
      tenantId: tenantCtx?.tenant.id,
      transform,
      requestUrl: request.url,
      isRaw: request.headers.get('x-edgecms-raw-image') === '1',
      rangeHeader: request.headers.get('range'),
      ifNoneMatch: request.headers.get('if-none-match'),
    })

    if (!result.success) {
      set.status = result.error.status
      setPublicMissCache(set.headers)
      return { error: result.error.message }
    }

    return result.data
  })
  .get('/assets/:assetId', {
    params: t.Object({
      assetId: t.String({ minLength: 1 }),
    }),
  }, async (ctx) => {
    const { params, query, set, request, db, r2, tenantCtx } = ctx
    const transform = parseImageTransformQuery(query as Record<string, string | undefined>)

    const result = await publicService.getAssetVariant({
      db,
      r2,
      assetId: params.assetId,
      variantParam: 'original',
      accept: request.headers.get('accept'),
      tenantId: tenantCtx?.tenant.id,
      transform,
      requestUrl: request.url,
      isRaw: request.headers.get('x-edgecms-raw-image') === '1',
      rangeHeader: request.headers.get('range'),
      ifNoneMatch: request.headers.get('if-none-match'),
    })

    if (!result.success) {
      set.status = result.error.status
      setPublicMissCache(set.headers)
      return { error: result.error.message }
    }

    return result.data
  })
  .get('/:collectionSlug', {
    params: t.Object({
      collectionSlug: t.String({ minLength: 1 }),
    }),
    query: t.Object({
      locale: t.Optional(t.String()),
      page: t.Optional(t.String()),
      perPage: t.Optional(t.String()),
      sort: t.Optional(t.String()),
    }),
  }, async (ctx) => {
    const { params, query, set, request, db, kv, tenantCtx, workerEnv } = ctx
    const page = parsePositiveInt(query.page as string | undefined, 1)
    const perPage = Math.min(100, parsePositiveInt(query.perPage as string | undefined, 20))

    const x402Res = await handleX402Gate(ctx, {
      secret: workerEnv?.BETTER_AUTH_SECRET || workerEnv?.EDGECMS_API_KEY || 'edgecms_secret',
      collectionSlug: params.collectionSlug,
      kv,
    })
    if (x402Res) return x402Res

    const rawQuery = Object.fromEntries(getRequestUrl(request).searchParams.entries()) as Record<
      string,
      string | undefined
    >
    const { filters, sort, errors } = parsePublicFilters(rawQuery)
    if (errors.length > 0) {
      set.status = 400
      setPublicMissCache(set.headers)
      return { error: 'Invalid filter parameters', details: errors }
    }

    // Resolve the collection lazily and at most once: KV/memory hits never
    // touch D1, and the singleton-alias fallback below reuses the lookup the
    // list miss already made instead of running a second query. A failed
    // lookup reads as "not found" (404, no-store), as before, never a 500.
    let collectionLookup: Promise<CollectionRow | null> | undefined
    const resolveCollection = () => {
      collectionLookup ??= publicRepository
        .findCollectionBySlug(db, params.collectionSlug, tenantCtx?.tenant.id)
        .then((row) => row ?? null)
        .catch(() => null)
      return collectionLookup
    }

    const result = await publicService.getCollectionList({
      db,
      kv,
      collectionSlug: params.collectionSlug,
      locale: (query.locale as string) || 'en',
      page,
      perPage,
      tenantId: tenantCtx?.tenant.id,
      filters,
      sort,
      resolveCollection,
      waitUntil: ctx,
    })

    if (!result.success && result.error.status === 404) {
      const singletonFallback = await publicService.getSingletonEntry({
        db,
        kv,
        collectionSlug: params.collectionSlug,
        locale: (query.locale as string) || 'en',
        tenantId: tenantCtx?.tenant.id,
        resolveCollection,
        waitUntil: ctx,
      })

      if (singletonFallback.success) {
        return respondWithSnapshot(
          set,
          singletonFallback.data.cache,
          singletonFallback.data.payload,
          request.headers.get('if-none-match')
        )
      }
    }

    if (!result.success) {
      set.status = result.error.status
      setPublicMissCache(set.headers)
      return { error: result.error.message }
    }

    return respondWithSnapshot(
      set,
      result.data.cache,
      result.data.payload,
      request.headers.get('if-none-match')
    )
  })
  .get('/:collectionSlug/:entryIdOrSlug', {
    params: t.Object({
      collectionSlug: t.String({ minLength: 1 }),
      entryIdOrSlug: t.String({ minLength: 1 }),
    }),
    query: t.Object({
      locale: t.Optional(t.String()),
      populate: t.Optional(t.String()),
      depth: t.Optional(t.String()),
    }),
  }, async (ctx) => {
    const { params, query, set, db, kv, tenantCtx, workerEnv, request } = ctx
    const depthParam = Number.parseInt((query.depth as string) || '1', 10)
    const depth = Math.min(Math.max(depthParam, 1), 3)

    const x402Res = await handleX402Gate(ctx, {
      secret: workerEnv?.BETTER_AUTH_SECRET || workerEnv?.EDGECMS_API_KEY || 'edgecms_secret',
      collectionSlug: params.collectionSlug,
      kv,
    })
    if (x402Res) return x402Res

    const result = await publicService.getCollectionEntry({
      db,
      kv,
      collectionSlug: params.collectionSlug,
      idOrSlug: params.entryIdOrSlug,
      locale: (query.locale as string) || 'en',
      populateParam: (query.populate as string) || '',
      depth,
      tenantId: tenantCtx?.tenant.id,
      waitUntil: ctx,
    })

    if (!result.success) {
      set.status = result.error.status
      setPublicMissCache(set.headers)
      return { error: result.error.message }
    }

    return respondWithSnapshot(
      set,
      result.data.cache,
      result.data.payload,
      request.headers.get('if-none-match')
    )
  })
  .get('/singleton/:collectionSlug', {
    params: t.Object({
      collectionSlug: t.String({ minLength: 1 }),
    }),
    query: t.Object({
      locale: t.Optional(t.String()),
    }),
  }, async (ctx) => {
    const { params, query, set, db, kv, tenantCtx, workerEnv, request } = ctx

    const x402Res = await handleX402Gate(ctx, {
      secret: workerEnv?.BETTER_AUTH_SECRET || workerEnv?.EDGECMS_API_KEY || 'edgecms_secret',
      collectionSlug: params.collectionSlug,
      kv,
    })
    if (x402Res) return x402Res

    const result = await publicService.getSingletonEntry({
      db,
      kv,
      collectionSlug: params.collectionSlug,
      locale: (query.locale as string) || 'en',
      tenantId: tenantCtx?.tenant.id,
    })

    if (!result.success) {
      set.status = result.error.status
      setPublicMissCache(set.headers)
      return { error: result.error.message }
    }

    return respondWithSnapshot(
      set,
      result.data.cache,
      result.data.payload,
      request.headers.get('if-none-match')
    )
  })
  .post('/preview-token', {
    body: t.Object({
      tenantSlug: t.Optional(t.String()),
      entrySlug: t.Optional(t.String()),
      entryId: t.Optional(t.String()),
      collectionSlug: t.Optional(t.String()),
      previewUrl: t.Optional(t.String()),
      ttlSeconds: t.Optional(t.Number()),
    }),
  }, async (ctx) => {
    const { body, params, set, tenantCtx, workerEnv } = ctx
    const tenantSlug =
      tenantCtx?.tenant.slug ||
      (params as Record<string, string | undefined> | undefined)?.tenantSlug ||
      body?.tenantSlug

    if (!tenantSlug) {
      set.status = 400
      return { error: 'Tenant context or tenantSlug is required' }
    }

    const secret =
      workerEnv?.PREVIEW_SECRET ||
      workerEnv?.BETTER_AUTH_SECRET ||
      workerEnv?.EDGECMS_API_KEY ||
      'edgecms_preview_secret'

    const result = await generatePreviewToken({
      tenantSlug,
      entrySlug: body.entrySlug,
      entryId: body.entryId,
      collectionSlug: body.collectionSlug,
      previewUrl: body.previewUrl,
      ttlSeconds: body.ttlSeconds,
      secret,
    })

    return result
  })
  .post('/preview-token/verify', {
    body: t.Object({
      token: t.String(),
      tenantSlug: t.Optional(t.String()),
    }),
  }, async (ctx) => {
    const { body, params, set, tenantCtx, workerEnv } = ctx
    const expectedTenantSlug =
      tenantCtx?.tenant.slug ||
      (params as Record<string, string | undefined> | undefined)?.tenantSlug ||
      body?.tenantSlug

    const secret =
      workerEnv?.PREVIEW_SECRET ||
      workerEnv?.BETTER_AUTH_SECRET ||
      workerEnv?.EDGECMS_API_KEY ||
      'edgecms_preview_secret'

    const result = await verifyPreviewToken(body.token, secret, {
      expectedTenantSlug: expectedTenantSlug || undefined,
    })

    if (!result.valid) {
      set.status = 401
      return { valid: false, error: result.error }
    }

    return { valid: true, payload: result.payload }
  })
