import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'

const JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'

const mockKvStore = new Map<string, string>()
const mockKv = {
  get: vi.fn(async (key: string) => mockKvStore.get(key) ?? null),
  put: vi.fn(async (key: string, value: string) => {
    mockKvStore.set(key, value)
  }),
} as unknown as KVNamespace

const mockEnv: Record<string, unknown> = {
  DB: { prepare: vi.fn() } as unknown as D1Database,
  CACHE: mockKv,
  BETTER_AUTH_SECRET: 'test-better-auth-secret-at-least-32',
  JWT_HS256_SECRET: JWT_SECRET,
  SUPER_ADMIN_EMAILS: 'root@example.com',
  SUPER_ADMIN_REQUIRE_MFA: undefined,
  MCP_API_KEY: 'deployment-mcp-key-0123456789',
}

mock.module('cloudflare:workers', () => ({ env: mockEnv }))

const mockGetSession = vi.fn(async (): Promise<unknown> => null)
const fakeAuth = { handler: () => new Response(null, { status: 404 }), api: { getSession: mockGetSession } }
mock.module('@/auth/auth', () => ({
  createAuth: () => fakeAuth,
  createAuthForEnv: () => fakeAuth,
}))

const tenantRow = {
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  mediaUploadMaxBytes: 5 * 1024 * 1024,
  mediaUploadMaxDimension: 2048,
  mediaAllowedMimeTypes: ['image/png'],
  requireMfa: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const tenantsRepositoryMock = {
  tenantsRepository: {
    findBySlug: vi.fn(async () => tenantRow),
    findTenantUser: vi.fn(async () => ({ role: 'admin' })),
    findMembershipRole: vi.fn(async () => 'admin'),
  },
}
mock.module('@/tenants/tenants.repository', () => tenantsRepositoryMock)
mock.module('../../tenants/tenants.repository', () => tenantsRepositoryMock)
mock.module('@/tenants/tenants.service', () => ({
  tenantsService: { findByIdOrSlug: vi.fn(async () => ({ success: true, data: tenantRow })) },
}))
const rbacServiceMock = {
  rbacService: { getEffectivePermissions: vi.fn(async () => ({ success: true, data: [] })) },
}
mock.module('@/auth/rbac.service', () => rbacServiceMock)
mock.module('../../auth/rbac.service', () => rbacServiceMock)
mock.module('@/users/users.repository', () => ({
  usersRepository: { findRoleById: vi.fn(async () => undefined), findFirstUserId: vi.fn() },
}))

const cacheBuster = Date.now()
const { createApiSecurityGuardPlugin } = await import(
  `../../auth/api-security.plugin?bypass=${cacheBuster}`
)
const { tenantMiddleware } = await import(`../../tenants/tenant.middleware?bypass=${cacheBuster}`)
const { betterAuthPlugin } = await import(`../../auth/auth.middleware?bypass=${cacheBuster}`)

function buildApp() {
  return new Elysia()
    .use(createApiSecurityGuardPlugin({ hstsHeader: null, resolveAllowedCorsOrigin: async () => null }))
    .use(tenantMiddleware)
    .use(betterAuthPlugin)
    .post('/api/tenants/:tenantSlug/api/mcp', (ctx: unknown) => ({
      reached: true,
      tenantId: (ctx as { tenant?: { tenant: { id: string } } }).tenant?.tenant.id,
    }))
    .post('/api/tenants/:tenantSlug/api/admin/entries', () => ({ reached: true }))
}

async function post(path: string, headers: Record<string, string> = {}) {
  const response = await buildApp().handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
  )
  const body = (await response.json().catch(() => null)) as {
    reached?: boolean
    tenantId?: string
    error?: { code?: string }
  } | null
  return { status: response.status, body }
}

const KEY = 'deployment-mcp-key-0123456789'

beforeEach(() => {
  vi.clearAllMocks()
  mockKvStore.clear()
  mockGetSession.mockResolvedValue(null)
  tenantRow.status = 'active'
})

describe('deployment MCP key on the tenant MCP endpoint (AI-06)', () => {
  it('still requires auth without a key', async () => {
    const { status, body } = await post('/api/tenants/acme/api/mcp')
    expect(status).toBe(401)
    expect(body?.reached).toBeUndefined()
  })

  it('lets a valid X-EdgeCMS-API-Key reach the MCP handler with the tenant resolved', async () => {
    const { status, body } = await post('/api/tenants/acme/api/mcp', { 'x-edgecms-api-key': KEY })
    expect(status).toBe(200)
    expect(body).toEqual({ reached: true, tenantId: 'tenant-1' })
  })

  it('lets a valid key sent as a bearer token through (not parsed as a JWT)', async () => {
    const { status, body } = await post('/api/tenants/acme/api/mcp', { authorization: `Bearer ${KEY}` })
    expect(status).toBe(200)
    expect(body?.reached).toBe(true)
  })

  it('does not let a wrong key through', async () => {
    const { status } = await post('/api/tenants/acme/api/mcp', { 'x-edgecms-api-key': 'wrong-key' })
    expect(status).toBe(401)
  })

  it('does not exempt other tenant admin routes', async () => {
    const { status, body } = await post('/api/tenants/acme/api/admin/entries', {
      'x-edgecms-api-key': KEY,
    })
    expect([401, 403]).toContain(status)
    expect(body?.reached).toBeUndefined()
  })

  it('keeps tenant state locks (suspended tenant)', async () => {
    tenantRow.status = 'suspended'
    const { status, body } = await post('/api/tenants/acme/api/mcp', { 'x-edgecms-api-key': KEY })
    expect(status).toBe(403)
    expect(body?.error?.code).toBe('TENANT_SUSPENDED')
  })
})
