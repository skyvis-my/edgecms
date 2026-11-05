import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'
import type { TenantContext } from '../../tenants/tenant-context'
import type { TenantRow } from '../../tenants/tenants.repository'

// Mock modules using Bun's mock.module (must be before dynamic imports)
const mockEnv: { DB: Record<string, never>; SUPER_ADMIN_EMAILS?: string } = {
  DB: {},
  SUPER_ADMIN_EMAILS: undefined,
}

mock.module('cloudflare:workers', () => ({
  env: mockEnv,
}))

mock.module('@/database/db', () => ({
  createDb: () => ({}),
}))

const mockFindBySlug = vi.fn()
const mockFindTenantUser = vi.fn()

mock.module('../../tenants/tenants.repository', () => ({
  tenantsRepository: {
    findBySlug: mockFindBySlug,
    findTenantUser: mockFindTenantUser,
  },
}))

const mockGetSession = vi.fn()

mock.module('@/auth/auth', () => {
  const authModule = {
    createAuth: () => ({
      api: {
        getSession: mockGetSession,
      },
    }),
  }
  return {
    ...authModule,
    createAuthForEnv: (env: { DB: unknown; BETTER_AUTH_SECRET?: string }, baseURL: string) =>
      (authModule.createAuth as (...args: unknown[]) => unknown)(env.DB, {
        secret: env.BETTER_AUTH_SECRET,
        baseURL,
      }),
  }
})

const { Elysia: MockElysia } = await import('elysia')

mock.module('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new MockElysia({ name: 'better-auth' }),
}))

// Cache-busted import: @/app (loaded by app/main tests) binds the real
// tenant.middleware; a plain import would reuse that copy with real deps.
const { tenantMiddleware } = await import(`../../tenants/tenant.middleware?bypass=${Date.now()}`)
const {
  clearTenantIsolateCache,
  getIsolateCachedTenant,
  setCachedTenant,
  setTenantIsolateCacheEnabled,
  TENANT_ISOLATE_TTL_MS,
} = await import('../../tenants/tenant-cache')

describe('Tenant Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearTenantIsolateCache()
  })

  it('should resolve valid tenant slug to context', async () => {
    const mockTenant = {
      id: 'tenant-123',
      slug: 'acme',
      name: 'Acme Corp',
      status: 'active',
      createdAt: '2026-02-07T00:00:00Z',
      updatedAt: '2026-02-07T00:00:00Z',
    }

    mockFindBySlug.mockResolvedValue(mockTenant)

    const app = new Elysia()
      .use(tenantMiddleware)
      .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
        tenant,
      }))

    const response = await app.handle(
      new Request('http://localhost/test/acme', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      tenant: {
        tenant: {
          id: 'tenant-123',
          slug: 'acme',
          name: 'Acme Corp',
          status: 'active',
        },
        resources: {
          mode: 'shared',
        },
      },
    })
  })

  it('should return 404 for unknown tenant slug', async () => {
    mockFindBySlug.mockResolvedValue(undefined)

    const app = new Elysia()
      .use(tenantMiddleware)
      .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
        tenant,
      }))

    const response = await app.handle(
      new Request('http://localhost/test/unknown', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(404)
    expect(mockFindBySlug).toHaveBeenCalledWith({}, 'unknown')
  })

  it('should return 403 for inactive tenant', async () => {
    const mockTenant = {
      id: 'tenant-456',
      slug: 'suspended',
      name: 'Suspended Corp',
      status: 'inactive',
      createdAt: '2026-02-07T00:00:00Z',
      updatedAt: '2026-02-07T00:00:00Z',
    }

    mockFindBySlug.mockResolvedValue(mockTenant)

    const app = new Elysia()
      .use(tenantMiddleware)
      .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
        tenant,
      }))

    const response = await app.handle(
      new Request('http://localhost/test/suspended', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(403)
  })

  it('should attach shared resource mode for all tenants', async () => {
    const mockTenant = {
      id: 'tenant-789',
      slug: 'newcorp',
      name: 'New Corp',
      status: 'active',
      createdAt: '2026-02-07T00:00:00Z',
      updatedAt: '2026-02-07T00:00:00Z',
    }

    mockFindBySlug.mockResolvedValue(mockTenant)

    const app = new Elysia()
      .use(tenantMiddleware)
      .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
        tenant,
      }))

    const response = await app.handle(
      new Request('http://localhost/test/newcorp', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(200)
    const data = (await response.json()) as { tenant?: TenantContext }
    expect(data.tenant?.resources).toEqual({ mode: 'shared' })
  })

  it('should not call tenant lookup for routes without tenantSlug param', async () => {
    vi.clearAllMocks()

    const app = new Elysia().use(tenantMiddleware).get('/status', () => ({
      status: 'ok',
    }))

    await app.handle(
      new Request('http://localhost/status', {
        method: 'GET',
      })
    )

    expect(mockFindBySlug).not.toHaveBeenCalled()
  })

  it('should expose tenant context to downstream handlers', async () => {
    const mockTenant = {
      id: 'tenant-999',
      slug: 'testcorp',
      name: 'Test Corp',
      status: 'active',
      createdAt: '2026-02-07T00:00:00Z',
      updatedAt: '2026-02-07T00:00:00Z',
    }

    mockFindBySlug.mockResolvedValue(mockTenant)

    const app = new Elysia()
      .use(tenantMiddleware)
      .get('/test/:tenantSlug/data', ({ tenant }: { tenant?: TenantContext }) => ({
        tenantId: tenant?.tenant.id,
        tenantName: tenant?.tenant.name,
        resourceMode: tenant?.resources.mode,
      }))

    const response = await app.handle(
      new Request('http://localhost/test/testcorp/data', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      tenantId: 'tenant-999',
      tenantName: 'Test Corp',
      resourceMode: 'shared',
    })
  })

  describe('tenant membership verification', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockEnv.SUPER_ADMIN_EMAILS = undefined
    })

    it('allows authenticated user who is a tenant member', async () => {
      const mockTenant = {
        id: 'tenant-123',
        slug: 'acme',
        name: 'Acme Corp',
        status: 'active',
        createdAt: '2026-02-07T00:00:00Z',
        updatedAt: '2026-02-07T00:00:00Z',
      }

      mockFindBySlug.mockResolvedValue(mockTenant)
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1', email: 'user@example.com', emailVerified: true },
        session: { id: 'session-1' },
      })
      mockFindTenantUser.mockResolvedValue({
        tenantId: 'tenant-123',
        userId: 'user-1',
        role: 'admin',
        createdAt: '2026-02-07T00:00:00Z',
      })

      const app = new Elysia()
        .use(tenantMiddleware)
        .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
          tenant,
        }))

      const response = await app.handle(
        new Request('http://localhost/test/acme', {
          method: 'GET',
        })
      )

      expect(response.status).toBe(200)
      expect(mockFindTenantUser).toHaveBeenCalledWith({}, 'tenant-123', 'user-1')
    })

    it('rejects authenticated user who is not a tenant member', async () => {
      const mockTenant = {
        id: 'tenant-456',
        slug: 'restricted',
        name: 'Restricted Corp',
        status: 'active',
        createdAt: '2026-02-07T00:00:00Z',
        updatedAt: '2026-02-07T00:00:00Z',
      }

      mockFindBySlug.mockResolvedValue(mockTenant)
      mockGetSession.mockResolvedValue({
        user: { id: 'user-2', email: 'outsider@example.com', emailVerified: true },
        session: { id: 'session-2' },
      })
      mockFindTenantUser.mockResolvedValue(undefined)

      const app = new Elysia()
        .use(tenantMiddleware)
        .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
          tenant,
        }))

      const response = await app.handle(
        new Request('http://localhost/test/restricted', {
          method: 'GET',
        })
      )

      expect(response.status).toBe(403)
      expect(mockFindTenantUser).toHaveBeenCalledWith({}, 'tenant-456', 'user-2')
    })

    it('allows unauthenticated requests (public routes)', async () => {
      const mockTenant = {
        id: 'tenant-789',
        slug: 'public',
        name: 'Public Corp',
        status: 'active',
        createdAt: '2026-02-07T00:00:00Z',
        updatedAt: '2026-02-07T00:00:00Z',
      }

      mockFindBySlug.mockResolvedValue(mockTenant)
      mockGetSession.mockResolvedValue(undefined)

      const app = new Elysia()
        .use(tenantMiddleware)
        .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
          tenant,
        }))

      const response = await app.handle(
        new Request('http://localhost/test/public', {
          method: 'GET',
        })
      )

      expect(response.status).toBe(200)
      expect(mockFindTenantUser).not.toHaveBeenCalled()
    })

    it('allows super-admin users without tenant membership', async () => {
      const mockTenant = {
        id: 'tenant-900',
        slug: 'enterprise',
        name: 'Enterprise Corp',
        status: 'active',
        createdAt: '2026-02-07T00:00:00Z',
        updatedAt: '2026-02-07T00:00:00Z',
      }

      mockEnv.SUPER_ADMIN_EMAILS = 'admin@example.com, super@example.com'
      mockFindBySlug.mockResolvedValue(mockTenant)
      mockGetSession.mockResolvedValue({
        user: { id: 'super-1', email: 'super@example.com', emailVerified: true },
        session: { id: 'session-super' },
      })
      mockFindTenantUser.mockResolvedValue(undefined)

      const app = new Elysia()
        .use(tenantMiddleware)
        .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
          tenant,
        }))

      const response = await app.handle(
        new Request('http://localhost/test/enterprise', {
          method: 'GET',
        })
      )

      expect(response.status).toBe(200)
      expect(mockFindTenantUser).not.toHaveBeenCalled()
    })

    it('allows users with superadmin session role without tenant membership', async () => {
      const mockTenant = {
        id: 'tenant-901',
        slug: 'enterprise-role',
        name: 'Enterprise Role Corp',
        status: 'active',
        createdAt: '2026-02-07T00:00:00Z',
        updatedAt: '2026-02-07T00:00:00Z',
      }

      mockEnv.SUPER_ADMIN_EMAILS = undefined
      mockFindBySlug.mockResolvedValue(mockTenant)
      mockGetSession.mockResolvedValue({
        user: { id: 'super-2', email: 'not-listed@example.com', emailVerified: true, role: 'superadmin' },
        session: { id: 'session-super-role' },
      })
      mockFindTenantUser.mockResolvedValue(undefined)

      const app = new Elysia()
        .use(tenantMiddleware)
        .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
          tenant,
        }))

      const response = await app.handle(
        new Request('http://localhost/test/enterprise-role', {
          method: 'GET',
        })
      )

      expect(response.status).toBe(200)
      expect(mockFindTenantUser).not.toHaveBeenCalled()
    })

    it('allows users with super-admin role present on session payload without tenant membership', async () => {
      const mockTenant = {
        id: 'tenant-902',
        slug: 'enterprise-session-role',
        name: 'Enterprise Session Role Corp',
        status: 'active',
        createdAt: '2026-02-07T00:00:00Z',
        updatedAt: '2026-02-07T00:00:00Z',
      }

      mockEnv.SUPER_ADMIN_EMAILS = undefined
      mockFindBySlug.mockResolvedValue(mockTenant)
      mockGetSession.mockResolvedValue({
        user: { id: 'super-3', email: 'not-listed@example.com', emailVerified: true },
        session: { id: 'session-super-role-alt', role: 'super-admin' },
      })
      mockFindTenantUser.mockResolvedValue(undefined)

      const app = new Elysia()
        .use(tenantMiddleware)
        .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
          tenant,
        }))

      const response = await app.handle(
        new Request('http://localhost/test/enterprise-session-role', {
          method: 'GET',
        })
      )

      expect(response.status).toBe(200)
      expect(mockFindTenantUser).not.toHaveBeenCalled()
    })
  })

  describe('in-isolate tenant caching (DL-10)', () => {
    beforeEach(() => {
      setTenantIsolateCacheEnabled(true)
      clearTenantIsolateCache()
      // Anonymous public reader: earlier tests leave a session implementation behind.
      mockGetSession.mockReset()
      mockGetSession.mockResolvedValue(null)
      mockEnv.SUPER_ADMIN_EMAILS = undefined
    })

    afterEach(() => {
      setTenantIsolateCacheEnabled(false)
      clearTenantIsolateCache()
    })

    it('bypasses D1 lookup on second request in same isolate and clears on invalidation', async () => {
      const mockTenant = {
        id: 'tenant-isolate-1',
        slug: 'isolate-test',
        name: 'Isolate Test Corp',
        status: 'active',
        createdAt: '2026-02-07T00:00:00Z',
        updatedAt: '2026-02-07T00:00:00Z',
      }

      mockFindBySlug.mockResolvedValue(mockTenant)

      const app = new Elysia()
        .use(tenantMiddleware)
        .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
          id: tenant?.tenant.id,
        }))

      // Request 1: cold cache -> hits D1
      const res1 = await app.handle(new Request('http://localhost/test/isolate-test'))
      expect(res1.status).toBe(200)
      expect(mockFindBySlug).toHaveBeenCalledTimes(1)

      // Request 2: new Request instance (warm isolate) -> hits isolate cache, skips D1!
      const res2 = await app.handle(new Request('http://localhost/test/isolate-test'))
      expect(res2.status).toBe(200)
      expect(mockFindBySlug).toHaveBeenCalledTimes(1)

      // Invalidation clears isolate cache -> next request hits D1 again
      clearTenantIsolateCache('isolate-test')
      const res3 = await app.handle(new Request('http://localhost/test/isolate-test'))
      expect(res3.status).toBe(200)
      expect(mockFindBySlug).toHaveBeenCalledTimes(2)
    })

    it('negatively caches nonexistent tenant slug to guard against flood stampedes', async () => {
      mockFindBySlug.mockResolvedValue(undefined)

      const app = new Elysia()
        .use(tenantMiddleware)
        .get('/test/:tenantSlug', ({ tenant }: { tenant?: TenantContext }) => ({
          id: tenant?.tenant.id,
        }))

      // Request 1: not found -> hits D1
      const res1 = await app.handle(new Request('http://localhost/test/nonexistent-tenant'))
      expect(res1.status).toBe(404)
      expect(mockFindBySlug).toHaveBeenCalledTimes(1)

      // Request 2: new Request -> negatively cached in isolate, skips D1!
      const res2 = await app.handle(new Request('http://localhost/test/nonexistent-tenant'))
      expect(res2.status).toBe(404)
      expect(mockFindBySlug).toHaveBeenCalledTimes(1)

      // Clearing isolate cache for that slug (as tenantsService.create does) immediately unblocks resolution
      clearTenantIsolateCache('nonexistent-tenant')
      mockFindBySlug.mockResolvedValueOnce({
        id: 'newly-created-id',
        slug: 'nonexistent-tenant',
        name: 'Newly Created',
        status: 'active',
        createdAt: '2026-02-07T00:00:00Z',
        updatedAt: '2026-02-07T00:00:00Z',
      })
      const res3 = await app.handle(new Request('http://localhost/test/nonexistent-tenant'))
      expect(res3.status).toBe(200)
      expect(mockFindBySlug).toHaveBeenCalledTimes(2)
    })

    const publicReadApp = () =>
      new Elysia()
        .use(tenantMiddleware)
        .get('/api/tenants/:tenantSlug/api/public/articles', ({ tenant }: { tenant?: TenantContext }) => ({
          id: tenant?.tenant.id,
        }))
    const publicRead = (app: ReturnType<typeof publicReadApp>, slug: string) =>
      app.handle(new Request(`http://localhost/api/tenants/${slug}/api/public/articles`))
    const tenantRow = (status: string, slug = 'hs04') => ({
      id: `tenant-${slug}`,
      slug,
      name: 'HS-04 Corp',
      status,
      createdAt: '2026-02-07T00:00:00Z',
      updatedAt: '2026-02-07T00:00:00Z',
    })

    it('keeps the documented staleness bound at or under 30 seconds', () => {
      expect(TENANT_ISOLATE_TTL_MS).toBeGreaterThan(0)
      expect(TENANT_ISOLATE_TTL_MS).toBeLessThanOrEqual(30_000)
    })

    it('blocks a disabled tenant immediately in the isolate that changed its state', async () => {
      const app = publicReadApp()
      mockFindBySlug.mockResolvedValue(tenantRow('active'))
      expect((await publicRead(app, 'hs04')).status).toBe(200)
      expect((await publicRead(app, 'hs04')).status).toBe(200)
      expect(mockFindBySlug).toHaveBeenCalledTimes(1)

      // tenantsService.update invalidates the slug on every status change.
      mockFindBySlug.mockResolvedValue(tenantRow('disabled'))
      clearTenantIsolateCache('hs04')
      const blocked = await publicRead(app, 'hs04')
      expect(blocked.status).toBe(403)
      expect(mockFindBySlug).toHaveBeenCalledTimes(2)
      // The disabled row is cached too: still blocked without another D1 read.
      expect((await publicRead(app, 'hs04')).status).toBe(403)
      expect(mockFindBySlug).toHaveBeenCalledTimes(2)
    })

    it('stops serving a disabled tenant in other isolates once the TTL elapses', async () => {
      const start = Date.now()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
      try {
        const app = publicReadApp()
        mockFindBySlug.mockResolvedValue(tenantRow('active'))
        expect((await publicRead(app, 'hs04')).status).toBe(200)

        // Disabled elsewhere: this isolate never sees the invalidation.
        mockFindBySlug.mockResolvedValue(tenantRow('disabled'))
        clock.mockReturnValue(start + TENANT_ISOLATE_TTL_MS - 1)
        expect((await publicRead(app, 'hs04')).status).toBe(200)

        clock.mockReturnValue(start + TENANT_ISOLATE_TTL_MS + 1)
        expect((await publicRead(app, 'hs04')).status).toBe(403)
      } finally {
        clock.mockRestore()
      }
    })

    it('does not let a lookup that started before an invalidation re-cache the old row', async () => {
      const app = publicReadApp()
      let resolveStale: (row: ReturnType<typeof tenantRow>) => void = () => {}
      mockFindBySlug.mockImplementationOnce(
        () => new Promise((resolve) => (resolveStale = resolve))
      )
      const inFlight = publicRead(app, 'hs04')
      await Promise.resolve()

      // Admin disables the tenant while the read above is still waiting on D1.
      clearTenantIsolateCache('hs04')
      resolveStale(tenantRow('active'))
      expect((await inFlight).status).toBe(200)

      mockFindBySlug.mockResolvedValue(tenantRow('disabled'))
      expect((await publicRead(app, 'hs04')).status).toBe(403)
    })

    it('keeps suspended tenants readable but caches nothing across tenants', async () => {
      const app = publicReadApp()
      mockFindBySlug.mockImplementation(async (_db: unknown, slug: string) =>
        slug === 'acme' ? tenantRow('suspended', 'acme') : tenantRow('disabled', 'globex')
      )
      expect((await publicRead(app, 'acme')).status).toBe(200)
      expect((await publicRead(app, 'globex')).status).toBe(403)
      expect((await publicRead(app, 'acme')).status).toBe(200)
      expect(mockFindBySlug).toHaveBeenCalledTimes(2)
    })

    it('caches a row only under its exact slug (P2)', async () => {
      const row = tenantRow('active', 'acme') as unknown as TenantRow
      // An id-or-slug lookup (api-security guard) resolved an id to acme's row.
      setCachedTenant(new Request('http://localhost/x'), row.id, Promise.resolve(row))
      await Promise.resolve()
      await Promise.resolve()
      expect(getIsolateCachedTenant(row.id)).toBeUndefined()

      setCachedTenant(new Request('http://localhost/y'), 'acme', Promise.resolve(row))
      await Promise.resolve()
      await Promise.resolve()
      expect(getIsolateCachedTenant('acme')).toEqual(row)
      expect(getIsolateCachedTenant('ACME')).toBeUndefined()
    })
  })
})
