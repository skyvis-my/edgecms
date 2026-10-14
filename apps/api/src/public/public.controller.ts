import { Elysia, t } from 'elysia'
import { assetsService } from '@/assets/assets.service'
import { parsePublicFilters } from '@/public/query-filter'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { getRequestUrl } from '@/shared/utils/request-url'
import { publicService, type ImageTransformOptions } from './public.service'
import { publicRepository } from './public.repository'
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

function setPublicCacheHeaders(
  headers: CacheHeaders,
  cacheTag: string,
  browserTTL: number,
  cdnTTL: number,
  debugHeaders?: Record<string, string>
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
  headers['x-edgecms-cache'] =
    debugHeaders?.['x-edgecms-cache'] ??
    (debugHeaders?.['X-Cache-Status'] ? debugHeaders['X-Cache-Status'].toLowerCase() : 'miss')
  if (debugHeaders) {
    for (const [key, value] of Object.entries(debugHeaders)) {
      headers[key] = value
    }
  }
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
      })
      if (!fallback.success) {
        set.status = fallback.error.status
        setPublicMissCache(set.headers)
        return { error: fallback.error.message }
      }

      return fallback.data
    }

    return new Response(result.object.body, {
      headers: {
        'Content-Type':
          result.object.httpMetadata?.contentType ?? `image/${params.format}`,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'CDN-Cache-Control': 'public, max-age=31536000',
        'x-edgecms-cache': 'hit',
      },
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

    // Resolve the collection once and pass it through: the singleton-alias
    // fallback below reuses it instead of running a second lookup pipeline.
    // Best-effort: on lookup failure the service re-resolves and surfaces
    // the proper error, so a preload miss must never 500 the route.
    let preloadedCollection: Awaited<
      ReturnType<typeof publicRepository.findCollectionBySlug>
    > | null = null
    try {
      preloadedCollection =
        (await publicRepository.findCollectionBySlug(
          db,
          params.collectionSlug,
          tenantCtx?.tenant.id
        )) ?? null
    } catch {
      preloadedCollection = null
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
      preloadedCollection,
    })

    if (!result.success && result.error.status === 404) {
      const singletonFallback = await publicService.getSingletonEntry({
        db,
        kv,
        collectionSlug: params.collectionSlug,
        locale: (query.locale as string) || 'en',
        tenantId: tenantCtx?.tenant.id,
        preloadedCollection,
      })

      if (singletonFallback.success) {
        setPublicCacheHeaders(
          set.headers,
          singletonFallback.data.cache.cacheTag,
          singletonFallback.data.cache.browserTTL,
          singletonFallback.data.cache.cdnTTL,
          singletonFallback.data.cache.debugHeaders
        )
        return singletonFallback.data.payload
      }
    }

    if (!result.success) {
      set.status = result.error.status
      setPublicMissCache(set.headers)
      return { error: result.error.message }
    }

    setPublicCacheHeaders(
      set.headers,
      result.data.cache.cacheTag,
      result.data.cache.browserTTL,
      result.data.cache.cdnTTL,
      result.data.cache.debugHeaders
    )

    return result.data.payload
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
    const { params, query, set, db, kv, tenantCtx, workerEnv } = ctx
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
    })

    if (!result.success) {
      set.status = result.error.status
      setPublicMissCache(set.headers)
      return { error: result.error.message }
    }

    setPublicCacheHeaders(
      set.headers,
      result.data.cache.cacheTag,
      result.data.cache.browserTTL,
      result.data.cache.cdnTTL,
      result.data.cache.debugHeaders
    )

    return result.data.payload
  })
  .get('/singleton/:collectionSlug', {
    params: t.Object({
      collectionSlug: t.String({ minLength: 1 }),
    }),
    query: t.Object({
      locale: t.Optional(t.String()),
    }),
  }, async (ctx) => {
    const { params, query, set, db, kv, tenantCtx, workerEnv } = ctx

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

    setPublicCacheHeaders(
      set.headers,
      result.data.cache.cacheTag,
      result.data.cache.browserTTL,
      result.data.cache.cdnTTL,
      result.data.cache.debugHeaders
    )

    return result.data.payload
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
