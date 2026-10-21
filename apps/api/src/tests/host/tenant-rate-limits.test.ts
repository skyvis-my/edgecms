import { afterEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { createApiSecurityGuardPlugin } = await import('@/auth/api-security.plugin')
const { __resetRateLimitState, DEFAULT_RATE_LIMIT_POLICIES, getRateLimitCategory } = await import(
  '@/auth/rate-limit.middleware'
)
const { createTenantRateLimitResolver } = await import('@/host/rate-limits')

type HostPolicies = import('@/host/host-policies').HostPolicies

function guardedApp(rateLimits?: HostPolicies['rateLimits']) {
  return new Elysia()
    .use(
      createApiSecurityGuardPlugin({
        resolveAllowedCorsOrigin: async () => null,
        resolveTenantRateLimit: createTenantRateLimitResolver(rateLimits),
      })
    )
    .get('/api/tenants/:tenantSlug/api/public/articles', () => ({ success: true }))
    .get('/api/public/articles', () => ({ success: true }))
}

const read = (app: ReturnType<typeof guardedApp>, path: string, ip = '203.0.113.1') =>
  app.handle(new Request(`http://x${path}`, { headers: { 'cf-connecting-ip': ip } }))

describe('HS-07 per-tenant rate limits', () => {
  afterEach(() => __resetRateLimitState())

  it('keeps the fixed framework policies without a host', async () => {
    expect(createTenantRateLimitResolver(undefined)).toBeUndefined()
    expect(getRateLimitCategory('/api/tenants/acme/api/public/articles', 'GET')).toBe('public_read')
    expect(DEFAULT_RATE_LIMIT_POLICIES.public_read).toEqual({ windowMs: 60_000, limit: 300 })

    const app = guardedApp()
    for (let i = 0; i < 300; i++) {
      expect((await read(app, '/api/tenants/acme/api/public/articles')).status).toBe(200)
    }
    const blocked = await read(app, '/api/tenants/acme/api/public/articles')
    expect(blocked.status).toBe(429)
  })

  it('applies the host policy per tenant and returns a typed 429', async () => {
    const app = guardedApp(({ tenantSlug, category }) =>
      tenantSlug === 'acme' && category === 'public_read'
        ? { windowMs: 60_000, limit: 2, upgradeUrl: 'https://host.example/upgrade' }
        : undefined
    )

    expect((await read(app, '/api/tenants/acme/api/public/articles')).status).toBe(200)
    expect((await read(app, '/api/tenants/acme/api/public/articles')).status).toBe(200)
    const blocked = await read(app, '/api/tenants/acme/api/public/articles')
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await blocked.json()).toEqual({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        details: {
          dimension: 'public_read',
          kind: 'rate',
          scope: 'caller',
          limit: 2,
          retryAfterSeconds: expect.any(Number),
          upgradeUrl: 'https://host.example/upgrade',
        },
      },
    })

    // Another tenant keeps the framework policy and its own budget.
    for (let i = 0; i < 5; i++) {
      expect((await read(app, '/api/tenants/globex/api/public/articles')).status).toBe(200)
    }
  })

  it('a tenant-wide budget caps all callers of that tenant only', async () => {
    const app = guardedApp(({ tenantSlug }) =>
      tenantSlug === 'acme' ? { windowMs: 60_000, limit: 100, tenantLimit: 3 } : undefined
    )
    expect((await read(app, '/api/tenants/acme/api/public/articles', '198.51.100.1')).status).toBe(200)
    expect((await read(app, '/api/tenants/acme/api/public/articles', '198.51.100.2')).status).toBe(200)
    expect((await read(app, '/api/tenants/acme/api/public/articles', '198.51.100.3')).status).toBe(200)
    const blocked = await read(app, '/api/tenants/acme/api/public/articles', '198.51.100.4')
    expect(blocked.status).toBe(429)
    expect(((await blocked.json()) as { error: { details: { scope: string } } }).error.details.scope).toBe(
      'tenant'
    )
    // Exhausting acme leaves globex untouched.
    expect((await read(app, '/api/tenants/globex/api/public/articles', '198.51.100.4')).status).toBe(200)
  })

  it('falls back to the framework policy for invalid or failing host policies, and caches', async () => {
    let calls = 0
    const resolver = createTenantRateLimitResolver(({ tenantSlug }) => {
      calls++
      if (tenantSlug === 'broken') throw new Error('plans down')
      return { windowMs: 0, limit: -1 }
    })!
    expect(await resolver('broken', 'admin_mutation')).toEqual(
      DEFAULT_RATE_LIMIT_POLICIES.admin_mutation
    )
    expect(await resolver('acme', 'admin_mutation')).toEqual(
      DEFAULT_RATE_LIMIT_POLICIES.admin_mutation
    )
    await resolver('acme', 'admin_mutation')
    expect(calls).toBe(2)
  })

  it('does not consult the host on global routes', async () => {
    const rateLimits = vi.fn(() => ({ windowMs: 60_000, limit: 1 }))
    const app = guardedApp(rateLimits)
    expect((await read(app, '/api/public/articles')).status).toBe(200)
    expect((await read(app, '/api/public/articles')).status).toBe(200)
    expect(rateLimits).not.toHaveBeenCalled()
  })
})
