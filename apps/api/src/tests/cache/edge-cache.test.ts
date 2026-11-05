import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  EDGE_CACHE_BROWSER_CC_HEADER,
  buildEdgeCacheKey,
  isEdgeCacheEligibleRequest,
  isEdgeCacheableResponse,
  matchEdgeCache,
  resolveEdgeCache,
  storeInEdgeCache,
  withEdgeCache,
} from '@/cache/edge-cache'

/** In-memory stand-in for `caches.default` keyed by URL (GET only, like the real Cache API). */
function createFakeCache() {
  const store = new Map<string, Response>()
  const puts: Array<{ url: string; response: Response }> = []
  const cache = {
    store,
    puts,
    async match(request: Request | string) {
      const url = typeof request === 'string' ? request : request.url
      const hit = store.get(url)
      return hit ? hit.clone() : undefined
    },
    async put(request: Request | string, response: Response) {
      const url = typeof request === 'string' ? request : request.url
      puts.push({ url, response: response.clone() })
      store.set(url, response)
    },
    async delete() {
      return false
    },
  }
  return cache
}

type FakeCache = ReturnType<typeof createFakeCache>

const scope = { tenantScope: 'tenant-a', collectionSlug: 'posts', locale: 'en', version: 3 }

function cacheableResponse(body = '{"entries":[]}', extra: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300, stale-if-error=86400',
      'CDN-Cache-Control': 'public, max-age=120, stale-while-revalidate=3600, stale-if-error=86400',
      'Cache-Tag': 'collection:posts,locale:en',
      ETag: 'W/"abc"',
      Vary: 'Accept-Encoding',
      'X-Cache-Status': 'MISS',
      'X-Cache-Source': 'origin',
      ...extra,
    },
  })
}

function waitUntilCollector() {
  const pending: Promise<unknown>[] = []
  return {
    pending,
    ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
    flush: () => Promise.all(pending),
  }
}

describe('edge cache (DL-03)', () => {
  const originalCaches = (globalThis as { caches?: unknown }).caches
  let fake: FakeCache

  beforeEach(() => {
    fake = createFakeCache()
    ;(globalThis as { caches?: unknown }).caches = { default: fake }
  })

  afterEach(() => {
    ;(globalThis as { caches?: unknown }).caches = originalCaches
  })

  describe('resolveEdgeCache', () => {
    it('returns null when the Cache API is unavailable (tests, Docker/Node hosts)', () => {
      ;(globalThis as { caches?: unknown }).caches = undefined
      expect(resolveEdgeCache()).toBeNull()
      ;(globalThis as { caches?: unknown }).caches = {}
      expect(resolveEdgeCache()).toBeNull()
    })

    it('returns caches.default when present', () => {
      expect(resolveEdgeCache()).toBe(fake as unknown as Cache)
    })
  })

  describe('buildEdgeCacheKey', () => {
    it('includes tenant, version, locale and a normalized query', () => {
      const a = buildEdgeCacheKey(
        new Request('https://cms.example.com/api/public/posts?sort=title&locale=en&page=2'),
        scope
      )
      const b = buildEdgeCacheKey(
        new Request('https://cms.example.com/api/public/posts?page=2&locale=en&sort=title'),
        scope
      )
      expect(a.url).toBe(b.url)
      expect(a.method).toBe('GET')
      expect(a.url).toContain('tenant-a')
      expect(a.url).toContain('v3')
      expect(a.url).toContain('en')
      expect(a.url.startsWith('https://cms.example.com/')).toBe(true)
    })

    it('separates tenants, locales, versions and queries', () => {
      const req = new Request('https://cms.example.com/api/public/posts?page=1')
      const base = buildEdgeCacheKey(req, scope).url
      expect(buildEdgeCacheKey(req, { ...scope, tenantScope: 'tenant-b' }).url).not.toBe(base)
      expect(buildEdgeCacheKey(req, { ...scope, locale: 'fr' }).url).not.toBe(base)
      expect(buildEdgeCacheKey(req, { ...scope, version: 4 }).url).not.toBe(base)
      expect(
        buildEdgeCacheKey(new Request('https://cms.example.com/api/public/posts?page=2'), scope).url
      ).not.toBe(base)
    })

    it('does not let a crafted path or query collide with another tenant scope', () => {
      const evil = buildEdgeCacheKey(
        new Request('https://cms.example.com/api/public/posts?x=/t/tenant-a/v3'),
        { ...scope, tenantScope: 'tenant-b' }
      ).url
      const real = buildEdgeCacheKey(
        new Request('https://cms.example.com/api/public/posts'),
        scope
      ).url
      expect(evil).not.toBe(real)
    })
  })

  describe('isEdgeCacheEligibleRequest', () => {
    const url = 'https://cms.example.com/api/public/posts'

    it('accepts an anonymous GET', () => {
      expect(isEdgeCacheEligibleRequest(new Request(url), 'posts')).toBe(true)
    })

    it.each([
      ['POST', {}],
      ['HEAD', {}],
    ])('rejects %s', (method) => {
      expect(isEdgeCacheEligibleRequest(new Request(url, { method }), 'posts')).toBe(false)
    })

    it.each([
      ['authorization', 'Bearer abc'],
      ['authorization', 'L402 tok'],
      ['cookie', 'session=1'],
      ['x-402-token', 'tok'],
      ['x-402-require', 'true'],
      ['x-api-key', 'k'],
      ['x-preview-token', 'p'],
      // DL-08: the header @edgecms/client sends with `previewToken`.
      ['x-edgecms-preview-token', 'p'],
      ['x-d1-session', 'bookmark'],
      ['x-session-bookmark', 'bookmark'],
    ])('rejects requests carrying %s', (name, value) => {
      expect(isEdgeCacheEligibleRequest(new Request(url, { headers: { [name]: value } }), 'posts')).toBe(
        false
      )
    })

    it.each(['preview=1', 'previewToken=abc', 'token=abc', 'paywall=true', 'x402=true'])(
      'rejects query %s',
      (query) => {
        expect(isEdgeCacheEligibleRequest(new Request(`${url}?${query}`), 'posts')).toBe(false)
      }
    )

    it('rejects paid-read (DL-07) collections', () => {
      expect(isEdgeCacheEligibleRequest(new Request(url), 'premium-posts')).toBe(false)
    })
  })

  describe('isEdgeCacheableResponse', () => {
    it('accepts a published 200 with a positive CDN TTL', () => {
      expect(isEdgeCacheableResponse(cacheableResponse())).toBe(true)
    })

    it('rejects non-200 statuses', () => {
      expect(
        isEdgeCacheableResponse(new Response('{}', { status: 404, headers: cacheableResponse().headers }))
      ).toBe(false)
      expect(
        isEdgeCacheableResponse(new Response(null, { status: 304, headers: cacheableResponse().headers }))
      ).toBe(false)
    })

    it.each([
      ['Set-Cookie', 'a=b'],
      ['WWW-Authenticate', 'L402 token="x"'],
      ['X-402-Settled', 'true'],
      ['X-402-Receipt', 'r'],
      ['X-Cache-Status', 'STALE'],
      ['Cache-Control', 'no-store'],
      ['Cache-Control', 'private, max-age=60'],
      ['CDN-Cache-Control', 'no-store'],
      ['CDN-Cache-Control', 'public, max-age=0'],
      ['Vary', '*'],
      ['Vary', 'Cookie'],
    ])('rejects responses with %s: %s', (name, value) => {
      expect(isEdgeCacheableResponse(cacheableResponse(undefined, { [name]: value }))).toBe(false)
    })

    it('rejects responses with no CDN-Cache-Control (the scheduled TTL is unknown)', () => {
      const res = cacheableResponse()
      res.headers.delete('CDN-Cache-Control')
      expect(isEdgeCacheableResponse(res)).toBe(false)
    })
  })

  describe('storeInEdgeCache / matchEdgeCache', () => {
    it('stores with the CDN TTL and restores the browser Cache-Control on a hit', async () => {
      const key = buildEdgeCacheKey(new Request('https://cms.example.com/api/public/posts'), scope)
      const wu = waitUntilCollector()
      storeInEdgeCache(fake as unknown as Cache, key, cacheableResponse(), wu.ctx)
      expect(wu.pending.length).toBe(1)
      await wu.flush()

      const stored = fake.puts[0]!.response
      expect(stored.headers.get('cache-control')).toBe('public, max-age=120')
      expect(stored.headers.get('cache-tag')).toBe('collection:posts,locale:en')
      expect(stored.headers.get('x-d1-session')).toBeNull()

      const hit = await matchEdgeCache(
        fake as unknown as Cache,
        key,
        new Request('https://cms.example.com/api/public/posts')
      )
      expect(hit).not.toBeNull()
      expect(hit!.status).toBe(200)
      expect(hit!.headers.get('cache-control')).toBe(
        'public, max-age=60, stale-while-revalidate=300, stale-if-error=86400'
      )
      expect(hit!.headers.get(EDGE_CACHE_BROWSER_CC_HEADER)).toBeNull()
      expect(hit!.headers.get('cdn-cache-control')).toContain('max-age=120')
      expect(hit!.headers.get('x-edgecms-cache')).toBe('hit')
      expect(hit!.headers.get('x-edgecms-edge-cache')).toBe('hit')
      expect(hit!.headers.get('x-cache-source')).toBe('edge')
      expect(hit!.headers.get('server-timing')).toMatch(/^cache;desc="edge";dur=\d+(\.\d+)?$/)
      expect(await hit!.text()).toBe('{"entries":[]}')
    })

    it('never stores per-request CORS, rate-limit or request-id headers', async () => {
      const key = buildEdgeCacheKey(new Request('https://cms.example.com/api/public/posts'), scope)
      const wu = waitUntilCollector()
      storeInEdgeCache(
        fake as unknown as Cache,
        key,
        cacheableResponse(undefined, {
          'Access-Control-Allow-Origin': 'https://site-a.example',
          'Access-Control-Allow-Credentials': 'true',
          'Retry-After': '5',
          'x-request-id': 'req-1',
          'x-d1-session': 'bookmark',
        }),
        wu.ctx
      )
      await wu.flush()
      const stored = fake.puts[0]!.response
      expect(stored.headers.get('access-control-allow-origin')).toBeNull()
      expect(stored.headers.get('access-control-allow-credentials')).toBeNull()
      expect(stored.headers.get('retry-after')).toBeNull()
      expect(stored.headers.get('x-request-id')).toBeNull()
      expect(stored.headers.get('x-d1-session')).toBeNull()
    })

    it('answers a matching If-None-Match with 304 on a hit', async () => {
      const key = buildEdgeCacheKey(new Request('https://cms.example.com/api/public/posts'), scope)
      storeInEdgeCache(fake as unknown as Cache, key, cacheableResponse())
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))

      const hit = await matchEdgeCache(
        fake as unknown as Cache,
        key,
        new Request('https://cms.example.com/api/public/posts', {
          headers: { 'if-none-match': 'W/"abc"' },
        })
      )
      expect(hit!.status).toBe(304)
      expect(hit!.headers.get('etag')).toBe('W/"abc"')
      expect(await hit!.text()).toBe('')
    })

    it('returns null on a miss and swallows Cache API errors', async () => {
      const key = buildEdgeCacheKey(new Request('https://cms.example.com/api/public/posts'), scope)
      expect(await matchEdgeCache(fake as unknown as Cache, key, new Request(key.url))).toBeNull()
      const broken = {
        match: async () => {
          throw new Error('boom')
        },
        put: async () => {
          throw new Error('boom')
        },
      } as unknown as Cache
      expect(await matchEdgeCache(broken, key, new Request(key.url))).toBeNull()
      const wu = waitUntilCollector()
      expect(() => storeInEdgeCache(broken, key, cacheableResponse(), wu.ctx)).not.toThrow()
      await wu.flush()
    })
  })

  describe('withEdgeCache', () => {
    const kv = {} as KVNamespace
    const getVersion = async () => 3

    function run(
      request: Request,
      produce: () => Promise<unknown>,
      opts: Partial<Parameters<typeof withEdgeCache>[0]> = {},
      set: { status?: number | string; headers: Record<string, unknown> } = { headers: {} }
    ) {
      const wu = waitUntilCollector()
      const result = withEdgeCache(
        {
          request,
          set,
          kv,
          tenantId: 'tenant-a',
          collectionSlug: 'posts',
          locale: 'en',
          waitUntil: wu.ctx,
          getVersion,
          ...opts,
        },
        produce
      )
      return { result, wu }
    }

    it('serves the second anonymous read from the edge without running the handler', async () => {
      let calls = 0
      const produce = async () => {
        calls++
        return cacheableResponse()
      }
      const first = run(new Request('https://cms.example.com/api/public/posts'), produce)
      const firstRes = (await first.result) as Response
      expect(firstRes.headers.get('x-edgecms-edge-cache')).toBe('miss')
      await first.wu.flush()

      const second = run(new Request('https://cms.example.com/api/public/posts'), produce)
      const secondRes = (await second.result) as Response
      expect(calls).toBe(1)
      expect(secondRes.headers.get('x-edgecms-edge-cache')).toBe('hit')
      expect(secondRes.headers.get('server-timing')).toContain('desc="edge"')
    })

    it('misses after a version bump (invalidation makes old entries unreachable)', async () => {
      let calls = 0
      const produce = async () => {
        calls++
        return cacheableResponse(`{"n":${calls}}`)
      }
      const first = run(new Request('https://cms.example.com/api/public/posts'), produce)
      await first.result
      await first.wu.flush()

      const bumped = run(new Request('https://cms.example.com/api/public/posts'), produce, {
        getVersion: async () => 4,
      })
      const res = (await bumped.result) as Response
      expect(calls).toBe(2)
      expect(await res.text()).toBe('{"n":2}')
    })

    it('never serves one tenant the other tenant entry', async () => {
      const a = run(new Request('https://cms.example.com/api/public/posts'), async () =>
        cacheableResponse('{"tenant":"a"}')
      )
      await a.result
      await a.wu.flush()

      const b = run(
        new Request('https://cms.example.com/api/public/posts'),
        async () => cacheableResponse('{"tenant":"b"}'),
        { tenantId: 'tenant-b' }
      )
      const res = (await b.result) as Response
      expect(await res.text()).toBe('{"tenant":"b"}')
    })

    it('converts a cacheable payload + set.headers into a stored Response', async () => {
      const set = {
        headers: Object.fromEntries(cacheableResponse().headers.entries()) as Record<string, unknown>,
      }
      const first = run(
        new Request('https://cms.example.com/api/public/posts'),
        async () => ({ entries: [1] }),
        {},
        set
      )
      const res = (await first.result) as Response
      expect(res).toBeInstanceOf(Response)
      expect(await res.json()).toEqual({ entries: [1] })
      await first.wu.flush()
      expect(fake.puts.length).toBe(1)
      expect(await fake.puts[0]!.response.text()).toBe('{"entries":[1]}')
    })

    it('does not store error payloads', async () => {
      const set = { status: 404, headers: { 'Cache-Control': 'no-store' } as Record<string, unknown> }
      const r = run(
        new Request('https://cms.example.com/api/public/missing'),
        async () => ({ error: 'nope' }),
        {},
        set
      )
      expect(await r.result).toEqual({ error: 'nope' })
      await r.wu.flush()
      expect(fake.puts.length).toBe(0)
    })

    it('bypasses lookup and store for credentialed requests', async () => {
      const seed = run(new Request('https://cms.example.com/api/public/posts'), async () =>
        cacheableResponse('{"cached":true}')
      )
      await seed.result
      await seed.wu.flush()

      let calls = 0
      const r = run(
        new Request('https://cms.example.com/api/public/posts', {
          headers: { authorization: 'Bearer x' },
        }),
        async () => {
          calls++
          return cacheableResponse('{"fresh":true}')
        }
      )
      const res = (await r.result) as Response
      await r.wu.flush()
      expect(calls).toBe(1)
      expect(await res.text()).toBe('{"fresh":true}')
      expect(fake.puts.length).toBe(1)
    })

    it('passes through untouched when the Cache API is unavailable', async () => {
      ;(globalThis as { caches?: unknown }).caches = undefined
      const original = cacheableResponse()
      const r = run(new Request('https://cms.example.com/api/public/posts'), async () => original)
      expect(await r.result).toBe(original)
      expect(r.wu.pending.length).toBe(0)
    })

    it('falls through to the handler when the version lookup fails', async () => {
      const original = cacheableResponse()
      const r = run(new Request('https://cms.example.com/api/public/posts'), async () => original, {
        getVersion: async () => {
          throw new Error('kv down')
        },
      })
      expect(await r.result).toBe(original)
      expect(fake.puts.length).toBe(0)
    })
  })
})
