import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'
import type { TenantContext } from '../../tenants/tenant-context'

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

mock.module('@/auth/auth', () => ({
  createAuth: () => ({
    api: {
      getSession: mockGetSession,
    },
  }),
}))

const { Elysia: MockElysia } = await import('elysia')

mock.module('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new MockElysia({ name: 'better-auth' }),
}))

// Import after mocking
const { tenantMiddleware } = await import('../../tenants/tenant.middleware')

describe('Tenant Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        user: { id: 'user-1', email: 'user@example.com' },
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
        user: { id: 'user-2', email: 'outsider@example.com' },
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
        user: { id: 'super-1', email: 'super@example.com' },
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
        user: { id: 'super-2', email: 'not-listed@example.com', role: 'superadmin' },
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
        user: { id: 'super-3', email: 'not-listed@example.com' },
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
})
