import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'

// HS-04 tenant states through the real tenant middleware.
const mockEnv: { DB: Record<string, never>; SUPER_ADMIN_EMAILS?: string } = {
  DB: {},
  SUPER_ADMIN_EMAILS: 'root@example.com',
}

mock.module('cloudflare:workers', () => ({ env: mockEnv }))
mock.module('@/database/db', () => ({ createDb: () => ({}) }))

const mockFindBySlug = vi.fn()
const mockFindTenantUser = vi.fn()
mock.module('../../tenants/tenants.repository', () => ({
  tenantsRepository: { findBySlug: mockFindBySlug, findTenantUser: mockFindTenantUser },
}))

const mockGetSession = vi.fn()
mock.module('@/auth/auth', () => ({
  createAuth: () => ({ api: { getSession: mockGetSession } }),
  createAuthForEnv: () => ({ api: { getSession: mockGetSession } }),
}))

const { Elysia: MockElysia } = await import('elysia')
mock.module('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new MockElysia({ name: 'better-auth' }),
}))

const { tenantMiddleware, isPublicReadRequest, tenantStateAccess } = await import(
  `../../tenants/tenant.middleware?bypass=${Date.now()}`
)

const app = new Elysia()
  .use(tenantMiddleware)
  .all('/api/tenants/:tenantSlug/*', ({ tenant }: { tenant?: { tenant: { id: string } } }) => ({
    tenantId: tenant?.tenant.id,
  }))

function tenantWithStatus(status: string) {
  return {
    id: 'tenant-1',
    slug: 'acme',
    name: 'Acme',
    status,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

const member = { user: { id: 'member-1', email: 'editor@acme.test', emailVerified: true }, session: { id: 's1' } }
const superAdmin = { user: { id: 'root-1', email: 'root@example.com', emailVerified: true }, session: { id: 's2' } }

async function call(method: string, path: string) {
  const response = await app.handle(new Request(`http://localhost${path}`, { method }))
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code: string }
  }
  return { status: response.status, code: body.error?.code }
}

const PUBLIC_READ = '/api/tenants/acme/api/public/posts'
const GRAPHQL = '/api/tenants/acme/api/graphql'
const ADMIN = '/api/tenants/acme/api/admin/entries'
const MCP = '/api/tenants/acme/api/admin/mcp'
const AI = '/api/tenants/acme/api/admin/ai/commands'
const SYNC = '/api/tenants/acme/api/admin/sync/push'
const PREVIEW_TOKEN = '/api/tenants/acme/api/public/preview-token'

describe('tenant states (HS-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockFindTenantUser.mockResolvedValue({ tenantId: 'tenant-1', userId: 'member-1', role: 'owner' })
  })

  describe('active', () => {
    it('serves members on admin routes and anonymous public reads', async () => {
      mockFindBySlug.mockResolvedValue(tenantWithStatus('active'))
      expect((await call('GET', PUBLIC_READ)).status).toBe(200)

      mockGetSession.mockResolvedValue(member)
      expect((await call('POST', ADMIN)).status).toBe(200)
    })
  })

  describe('suspended', () => {
    beforeEach(() => {
      mockFindBySlug.mockResolvedValue(tenantWithStatus('suspended'))
    })

    it('keeps anonymous public reads and GraphQL serving', async () => {
      expect((await call('GET', PUBLIC_READ)).status).toBe(200)
      expect((await call('HEAD', PUBLIC_READ)).status).toBe(200)
      expect((await call('GET', GRAPHQL)).status).toBe(200)
      expect((await call('POST', GRAPHQL)).status).toBe(200)
    })

    it('locks admin, MCP, AI and sync for members, including the owner', async () => {
      mockGetSession.mockResolvedValue(member)
      for (const [method, path] of [
        ['GET', ADMIN],
        ['POST', ADMIN],
        ['POST', MCP],
        ['POST', AI],
        ['POST', SYNC],
      ] as const) {
        expect(await call(method, path)).toEqual({ status: 403, code: 'TENANT_SUSPENDED' })
      }
    })

    it('blocks anonymous admin requests too', async () => {
      expect(await call('POST', MCP)).toEqual({ status: 403, code: 'TENANT_SUSPENDED' })
    })

    it('blocks draft preview token issuance', async () => {
      mockGetSession.mockResolvedValue(member)
      expect(await call('POST', PREVIEW_TOKEN)).toEqual({ status: 403, code: 'TENANT_SUSPENDED' })
    })

    it('still rejects non-members on public reads when authenticated', async () => {
      mockGetSession.mockResolvedValue({ user: { id: 'stranger', email: 'x@y.test', emailVerified: true }, session: {} })
      mockFindTenantUser.mockResolvedValue(undefined)
      expect((await call('GET', PUBLIC_READ)).status).toBe(403)
    })

    it('lets super-admins in to inspect and recover', async () => {
      mockGetSession.mockResolvedValue(superAdmin)
      expect((await call('POST', ADMIN)).status).toBe(200)
    })
  })

  for (const status of ['pending', 'disabled', 'inactive', 'unknown-state']) {
    describe(status, () => {
      beforeEach(() => {
        mockFindBySlug.mockResolvedValue(tenantWithStatus(status))
      })

      it('blocks public reads, GraphQL and admin for everyone but super-admins', async () => {
        expect(await call('GET', PUBLIC_READ)).toEqual({ status: 403, code: 'TENANT_UNAVAILABLE' })
        expect(await call('POST', GRAPHQL)).toEqual({ status: 403, code: 'TENANT_UNAVAILABLE' })

        mockGetSession.mockResolvedValue(member)
        expect(await call('GET', PUBLIC_READ)).toEqual({ status: 403, code: 'TENANT_UNAVAILABLE' })
        expect(await call('POST', ADMIN)).toEqual({ status: 403, code: 'TENANT_UNAVAILABLE' })
      })

      it('admits super-admins', async () => {
        mockGetSession.mockResolvedValue(superAdmin)
        expect((await call('POST', ADMIN)).status).toBe(200)
        expect((await call('GET', PUBLIC_READ)).status).toBe(200)
      })
    })
  }
})

describe('isPublicReadRequest', () => {
  it('accepts canonical and rewritten public/GraphQL read paths', () => {
    expect(isPublicReadRequest('GET', '/api/tenants/acme/public/posts', 'acme')).toBe(true)
    expect(isPublicReadRequest('GET', '/api/tenants/acme/api/public/assets/a/small', 'acme')).toBe(true)
    expect(isPublicReadRequest('POST', '/api/tenants/acme/graphql', 'acme')).toBe(true)
  })

  it('rejects writes, admin paths, look-alike prefixes and other tenants', () => {
    expect(isPublicReadRequest('POST', '/api/tenants/acme/api/public/posts', 'acme')).toBe(false)
    expect(isPublicReadRequest('DELETE', '/api/tenants/acme/api/graphql', 'acme')).toBe(false)
    expect(isPublicReadRequest('GET', '/api/tenants/acme/api/admin/entries', 'acme')).toBe(false)
    expect(isPublicReadRequest('GET', '/api/tenants/acme/api/publicity', 'acme')).toBe(false)
    expect(isPublicReadRequest('GET', '/api/tenants/acme/api/graphqlx', 'acme')).toBe(false)
    expect(isPublicReadRequest('GET', '/api/tenants/acme-two/api/public/posts', 'acme')).toBe(false)
    expect(isPublicReadRequest('GET', '/api/tenants/acme/api/public/preview-token', 'acme')).toBe(false)
  })

  it('maps states to access', () => {
    expect(tenantStateAccess('active', false)).toBe('allow')
    expect(tenantStateAccess('suspended', true)).toBe('allow')
    expect(tenantStateAccess('suspended', false)).toBe('super-admin-only')
    expect(tenantStateAccess('disabled', true)).toBe('super-admin-only')
    expect(tenantStateAccess('pending', true)).toBe('super-admin-only')
  })
})
