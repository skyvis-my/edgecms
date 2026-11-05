import { kvService } from '@/cache/kv.service'
import { scheduleDeferredWork } from '@/commands/deferred-work'
import { logger } from '@/observability/logger'
import { incrementMetric } from '@/observability/metrics'
import { isMonetizedRequest } from '@/public/x402.middleware'

/**
 * DL-03 edge cache layer: Cloudflare Cache API (`caches.default`) in front of
 * the Worker's memory → KV → D1 path for anonymous public GET reads.
 *
 * - Lookup happens before the snapshot path; stores go through `waitUntil`.
 * - Keys carry tenant, collection, locale, the KV content version and the
 *   normalized query, so a version bump (command invalidation or the DL-05
 *   scheduler alarm) makes every older entry unreachable. Entries also keep
 *   their `Cache-Tag`, so zone purge-by-tag still applies.
 * - Credentialed, preview (DL-08), paid-read (DL-07) and read-your-writes
 *   (D1 session bookmark) requests skip the layer entirely.
 * - Only 200 responses with a positive `CDN-Cache-Control` max-age (already
 *   shrunk toward the next scheduled transition, DL-05) and no cookies or auth
 *   challenge headers are stored.
 * - Without `caches.default` (tests, Docker/Node hosts) every call is a no-op.
 *
 * Kept self-contained so the router hook in `public.controller.ts` stays small.
 */

/** Internal header holding the browser `Cache-Control` on stored copies. */
export const EDGE_CACHE_BROWSER_CC_HEADER = 'x-edgecms-browser-cache-control'
/** Response header reporting this layer's outcome: `hit` or `miss`. */
export const EDGE_CACHE_STATUS_HEADER = 'x-edgecms-edge-cache'

const KEY_PREFIX = '/__edgecms-edge-cache'

const CREDENTIAL_REQUEST_HEADERS = [
  'authorization',
  'cookie',
  'x-api-key',
  'x-402-token',
  'x-preview-token',
  'x-edgecms-preview',
  // Read-your-writes: the client wants D1 at least as fresh as its bookmark.
  'x-d1-session',
  'x-session-bookmark',
]

const BYPASS_QUERY_PARAMS = ['preview', 'previewtoken', 'preview_token', 'token']

const UNCACHEABLE_RESPONSE_HEADERS = [
  'set-cookie',
  'www-authenticate',
  'x-402-settled',
  'x-402-receipt',
  'x-402-challenge',
]

/** Headers never written into the shared cache (per-request or per-isolate). */
const STRIPPED_ON_STORE = [
  'set-cookie',
  'x-d1-session',
  'server-timing',
  'x-response-time',
  'x-request-id',
  'retry-after',
  'x-edgecms-cache',
  EDGE_CACHE_STATUS_HEADER,
]
/** Header prefixes set per request origin or client (CORS, rate limits). */
const STRIPPED_PREFIXES_ON_STORE = ['access-control-', 'x-ratelimit-', 'ratelimit-']

export type EdgeCacheScope = {
  tenantScope: string
  collectionSlug: string
  locale: string
  version: number
}

type MutableSet = { status?: number | string; headers: Record<string, unknown> }

/** `caches.default` when the runtime provides it; otherwise null. */
export function resolveEdgeCache(): Cache | null {
  try {
    const storage = (globalThis as { caches?: { default?: Cache } }).caches
    const cache = storage?.default
    if (cache && typeof cache.match === 'function' && typeof cache.put === 'function') {
      return cache
    }
  } catch {
    // Accessing `caches` can throw on some hosts; treat as unavailable.
  }
  return null
}

/** True only for anonymous, non-preview, non-paid public GET reads. */
export function isEdgeCacheEligibleRequest(request: Request, collectionSlug: string): boolean {
  if (request.method !== 'GET') return false
  for (const name of CREDENTIAL_REQUEST_HEADERS) {
    if (request.headers.has(name)) return false
  }
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return false
  }
  for (const name of url.searchParams.keys()) {
    if (BYPASS_QUERY_PARAMS.includes(name.toLowerCase())) return false
  }
  return !isMonetizedRequest(request, collectionSlug)
}

/**
 * Synthetic GET key on the request's own origin (so zone purges apply):
 * `/__edgecms-edge-cache/{tenant}/{collection}/{locale}/v{version}{path}?{sorted query}`.
 * Scope parts are URI-encoded path segments ahead of the request path, so no
 * crafted path or query can reach another tenant's prefix.
 */
export function buildEdgeCacheKey(request: Request, scope: EdgeCacheScope): Request {
  const url = new URL(request.url)
  const params = [...url.searchParams.entries()].sort(([a, av], [b, bv]) =>
    a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1
  )
  const query = new URLSearchParams(params).toString()
  const segments = [scope.tenantScope, scope.collectionSlug, scope.locale]
    .map((part) => encodeURIComponent(part))
    .join('/')
  const keyUrl = `${url.origin}${KEY_PREFIX}/${segments}/v${scope.version}${url.pathname}${
    query ? `?${query}` : ''
  }`
  return new Request(keyUrl, { method: 'GET' })
}

function readMaxAge(value: string | null): number | null {
  if (!value) return null
  const directives = value.toLowerCase()
  if (/(^|[\s,])(no-store|no-cache|private)([\s,=]|$)/.test(directives)) return null
  const match = /(?:^|[\s,])max-age=(\d+)/.exec(directives)
  if (!match) return null
  const seconds = Number.parseInt(match[1]!, 10)
  return Number.isFinite(seconds) ? seconds : null
}

/** Only published 200s with a positive CDN TTL, no cookies and no auth/payment headers. */
export function isEdgeCacheableResponse(response: Response): boolean {
  if (response.status !== 200) return false
  for (const name of UNCACHEABLE_RESPONSE_HEADERS) {
    if (response.headers.has(name)) return false
  }
  if ((response.headers.get('x-cache-status') ?? '').toUpperCase() === 'STALE') return false
  const vary = (response.headers.get('vary') ?? '').toLowerCase()
  if (vary && vary.split(',').some((v) => v.trim() && v.trim() !== 'accept-encoding')) return false
  const browser = response.headers.get('cache-control')
  if (!browser || readMaxAge(browser) === null || !/(^|[\s,])public([\s,]|$)/i.test(browser)) {
    return false
  }
  const cdnTtl = readMaxAge(response.headers.get('cdn-cache-control'))
  return cdnTtl !== null && cdnTtl > 0
}

/**
 * Store a copy in the edge cache via `waitUntil`. The stored `Cache-Control`
 * carries the CDN TTL (the Cache API honours `Cache-Control`); the browser value
 * is kept in an internal header and restored on a hit.
 */
export function storeInEdgeCache(
  cache: Cache,
  key: Request,
  response: Response,
  waitUntil?: unknown
): void {
  let copy: Response
  try {
    const cdnTtl = readMaxAge(response.headers.get('cdn-cache-control'))
    if (cdnTtl === null || cdnTtl <= 0) return
    const headers = new Headers(response.headers)
    for (const name of STRIPPED_ON_STORE) headers.delete(name)
    const prefixed: string[] = []
    headers.forEach((_value, name) => {
      if (STRIPPED_PREFIXES_ON_STORE.some((prefix) => name.startsWith(prefix))) prefixed.push(name)
    })
    for (const name of prefixed) headers.delete(name)
    headers.set(EDGE_CACHE_BROWSER_CC_HEADER, response.headers.get('cache-control') ?? '')
    headers.set('cache-control', `public, max-age=${cdnTtl}`)
    copy = new Response(response.clone().body, { status: 200, headers })
  } catch (err) {
    logger.warn('edge_cache_store_skipped', {
      error: err instanceof Error ? err.message : String(err),
    })
    return
  }
  scheduleDeferredWork(waitUntil, cache.put(key, copy), 'edge_cache_put')
}

function etagMatches(ifNoneMatch: string | null, etag: string | null): boolean {
  if (!ifNoneMatch || !etag) return false
  const normalize = (v: string) => v.trim().replace(/^W\//, '').replace(/"/g, '')
  const target = normalize(etag)
  return ifNoneMatch.split(',').some((c) => {
    const t = c.trim()
    return t === '*' || t === 'W/"*"' || normalize(t) === target
  })
}

/** Look up the key; on a hit, return a response ready to send (200 or 304). */
export async function matchEdgeCache(
  cache: Cache,
  key: Request,
  request: Request
): Promise<Response | null> {
  const started = Date.now()
  let cached: Response | undefined
  try {
    cached = await cache.match(key)
  } catch (err) {
    logger.warn('edge_cache_match_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
  if (!cached) {
    incrementMetric('cache_misses_total', { layer: 'edge' })
    return null
  }
  incrementMetric('cache_hits_total', { layer: 'edge' })

  const headers = new Headers(cached.headers)
  const browser = headers.get(EDGE_CACHE_BROWSER_CC_HEADER)
  headers.delete(EDGE_CACHE_BROWSER_CC_HEADER)
  if (browser) headers.set('cache-control', browser)
  const duration = Date.now() - started
  headers.set('x-edgecms-cache', 'hit')
  headers.set(EDGE_CACHE_STATUS_HEADER, 'hit')
  headers.set('X-Cache-Status', 'HIT')
  headers.set('X-Cache-Source', 'edge')
  headers.set('X-Response-Time', `${duration}ms`)
  headers.set('Server-Timing', `cache;desc="edge";dur=${duration}`)

  if (etagMatches(request.headers.get('if-none-match'), headers.get('etag'))) {
    headers.delete('content-type')
    headers.delete('content-length')
    return new Response(null, { status: 304, headers })
  }
  return new Response(cached.body, { status: 200, headers })
}

function toCacheableResponse(result: unknown, set: MutableSet): Response | null {
  if (result instanceof Response) return result
  const status = set.status === undefined ? 200 : Number(set.status)
  if (status !== 200 || result === undefined || result === null || typeof result !== 'object') {
    return null
  }
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' })
  for (const [k, v] of Object.entries(set.headers)) {
    if (v === undefined) continue
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v))
  }
  // Only build a Response when it will actually be stored; otherwise the
  // handler's original payload flows through unchanged.
  const probe = new Response(null, { status: 200, headers })
  if (!isEdgeCacheableResponse(probe)) return null
  let body: string
  try {
    body = JSON.stringify(result)
  } catch {
    return null
  }
  return new Response(body, { status: 200, headers })
}

export type WithEdgeCacheOptions = {
  request: Request
  set: MutableSet
  kv: KVNamespace
  tenantId?: string
  collectionSlug: string
  locale: string
  /** Elysia ctx or ExecutionContext carrying `waitUntil`. */
  waitUntil?: unknown
  /** Override for tests; defaults to the KV content version counter. */
  getVersion?: (
    kv: KVNamespace,
    collectionSlug: string,
    locale: string,
    tenantId?: string
  ) => Promise<number>
}

/**
 * Router hook: serve from the edge cache when possible; otherwise run
 * `produce` (the normal memory/KV/D1 handler) and store a cacheable result.
 */
export async function withEdgeCache(
  options: WithEdgeCacheOptions,
  produce: () => Promise<unknown>
): Promise<unknown> {
  const cache = resolveEdgeCache()
  if (!cache || !isEdgeCacheEligibleRequest(options.request, options.collectionSlug)) {
    return produce()
  }

  let key: Request
  try {
    const getVersion = options.getVersion ?? kvService.getCurrentVersion.bind(kvService)
    const version = await getVersion(
      options.kv,
      options.collectionSlug,
      options.locale,
      options.tenantId
    )
    key = buildEdgeCacheKey(options.request, {
      tenantScope: options.tenantId || 'global',
      collectionSlug: options.collectionSlug,
      locale: options.locale,
      version,
    })
  } catch (err) {
    logger.warn('edge_cache_key_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return produce()
  }

  const hit = await matchEdgeCache(cache, key, options.request)
  if (hit) return hit

  const result = await produce()
  const response = toCacheableResponse(result, options.set)
  if (!response || !isEdgeCacheableResponse(response)) return result

  storeInEdgeCache(cache, key, response, options.waitUntil)
  try {
    response.headers.set(EDGE_CACHE_STATUS_HEADER, 'miss')
  } catch {
    // Immutable headers (e.g. a fetched Response): the outcome header is optional.
  }
  return response
}

/** Minimal shape of the public read route context the hook needs. */
type EdgeCacheRouteContext = {
  request: Request
  set: MutableSet
  kv: KVNamespace
  tenantCtx?: { tenant: { id: string } }
  params: { collectionSlug: string }
  query: Record<string, unknown>
}

/**
 * Wrap a public read route handler with the edge cache. Lookup runs before the
 * handler (and its x402 gate): paid-read requests are never eligible, so the
 * gate still decides every request it would challenge.
 */
export function edgeCached<H extends (ctx: any) => unknown>(handler: H): H {
  // Typed as `H` so the route keeps Elysia's inferred context for its handler.
  const wrapped = (ctx: EdgeCacheRouteContext) =>
    withEdgeCache(
      {
        request: ctx.request,
        set: ctx.set,
        kv: ctx.kv,
        tenantId: ctx.tenantCtx?.tenant.id,
        collectionSlug: ctx.params.collectionSlug,
        locale: typeof ctx.query.locale === 'string' && ctx.query.locale ? ctx.query.locale : 'en',
        waitUntil: ctx,
      },
      async () => handler(ctx)
    )
  return wrapped as unknown as H
}
