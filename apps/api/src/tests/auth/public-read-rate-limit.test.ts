import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'

// DL-10: a public read must not wait on a KV round trip for rate limiting.
const testEnv: Record<string, unknown> = {}
mock.module('cloudflare:workers', () => ({ env: testEnv }))

const { createApiSecurityGuardPlugin } = await import('@/auth/api-security.plugin')
const { __resetRateLimitState } = await import('@/auth/rate-limit.middleware')
const { createTenantRateLimitResolver } = await import('@/host/rate-limits')

type HostPolicies = import('@/host/host-policies').HostPolicies

function spyKv() {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
  }
}

function guardedApp(rateLimits?: HostPolicies['rateLimits']) {
  return new Elysia()
    .use(
      createApiSecurityGuardPlugin({
        resolveAllowedCorsOrigin: async () => null,
        resolveTenantRateLimit: createTenantRateLimitResolver(rateLimits),
      })
    )
    .get('/api/tenants/:tenantSlug/api/public/articles', () => ({ success: true }))
    .get('/api/csrf', () => ({ success: true }))
}

const read = (app: ReturnType<typeof guardedApp>, path: string, ip = '203.0.113.9') =>
  app.handle(new Request(`http://x${path}`, { headers: { 'cf-connecting-ip': ip } }))

describe('DL-10 public read rate limiting', () => {
  let kv: ReturnType<typeof spyKv>

  beforeEach(() => {
    kv = spyKv()
    for (const key of Object.keys(testEnv)) delete testEnv[key]
    testEnv.CACHE = kv
  })

  afterEach(() => __resetRateLimitState())

  it('counts public reads in isolate memory without touching KV', async () => {
    const app = guardedApp()
    for (let i = 0; i < 300; i++) {
      expect((await read(app, '/api/tenants/acme/api/public/articles')).status).toBe(200)
    }
    const blocked = await read(app, '/api/tenants/acme/api/public/articles')
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(kv.get).not.toHaveBeenCalled()
    expect(kv.put).not.toHaveBeenCalled()
  })

  it('keeps the KV-backed limiter for non-public surfaces', async () => {
    const app = guardedApp()
    expect((await read(app, '/api/csrf')).status).toBe(200)
    expect(kv.get).toHaveBeenCalled()
  })

  it('restores the KV-backed limiter for public reads when configured', async () => {
    testEnv.PUBLIC_READ_RATE_LIMIT_STORE = 'kv'
    const app = guardedApp()
    expect((await read(app, '/api/tenants/acme/api/public/articles')).status).toBe(200)
    expect(kv.get).toHaveBeenCalled()
  })

  it('uses the Cloudflare rate-limiting binding when present', async () => {
    const limit = vi.fn(async ({ key }: { key: string }) => ({ success: !key.includes('203.0.113.66') }))
    testEnv.PUBLIC_READ_RATE_LIMITER = { limit }
    const app = guardedApp()

    expect((await read(app, '/api/tenants/acme/api/public/articles')).status).toBe(200)
    const blocked = await read(app, '/api/tenants/acme/api/public/articles', '203.0.113.66')
    expect(blocked.status).toBe(429)
    expect(limit).toHaveBeenCalledTimes(2)
    // The binding key is scoped by tenant slug exactly (P2).
    expect(limit.mock.calls[0]?.[0].key).toStartWith('acme:ip:203.0.113.9:')
    expect(kv.get).not.toHaveBeenCalled()
  })

  it('falls back to the isolate counter when the binding throws', async () => {
    testEnv.PUBLIC_READ_RATE_LIMITER = {
      limit: vi.fn(async () => {
        throw new Error('binding unavailable')
      }),
    }
    const app = guardedApp(({ tenantSlug }) =>
      tenantSlug === 'acme' ? { windowMs: 60_000, limit: 1 } : undefined
    )
    expect((await read(app, '/api/tenants/globex/api/public/articles')).status).toBe(200)
    expect((await read(app, '/api/tenants/acme/api/public/articles')).status).toBe(200)
    expect((await read(app, '/api/tenants/acme/api/public/articles')).status).toBe(429)
    expect(kv.get).not.toHaveBeenCalled()
  })

  it('enforces a host per-tenant policy in the isolate instead of the fixed binding', async () => {
    const limit = vi.fn(async () => ({ success: true }))
    testEnv.PUBLIC_READ_RATE_LIMITER = { limit }
    const app = guardedApp(({ tenantSlug }) =>
      tenantSlug === 'acme' ? { windowMs: 60_000, limit: 2 } : undefined
    )
    expect((await read(app, '/api/tenants/acme/api/public/articles')).status).toBe(200)
    expect((await read(app, '/api/tenants/acme/api/public/articles')).status).toBe(200)
    expect((await read(app, '/api/tenants/acme/api/public/articles')).status).toBe(429)
    expect(limit).not.toHaveBeenCalled()

    // Default-policy tenants keep using the binding.
    expect((await read(app, '/api/tenants/globex/api/public/articles')).status).toBe(200)
    expect(limit).toHaveBeenCalledTimes(1)
  })

  it('applies a tenant-wide public budget without KV, per tenant only', async () => {
    const app = guardedApp(({ tenantSlug }) =>
      tenantSlug === 'acme' ? { windowMs: 60_000, limit: 100, tenantLimit: 2 } : undefined
    )
    expect((await read(app, '/api/tenants/acme/api/public/articles', '198.51.100.1')).status).toBe(200)
    expect((await read(app, '/api/tenants/acme/api/public/articles', '198.51.100.2')).status).toBe(200)
    expect((await read(app, '/api/tenants/acme/api/public/articles', '198.51.100.3')).status).toBe(429)
    expect((await read(app, '/api/tenants/globex/api/public/articles', '198.51.100.3')).status).toBe(200)
    expect(kv.get).not.toHaveBeenCalled()
  })
})
