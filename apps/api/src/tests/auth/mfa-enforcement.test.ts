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
const { createAccessToken } = await import(`../../auth/jwt?bypass=${cacheBuster}`)

function buildApp() {
  return new Elysia()
    .use(createApiSecurityGuardPlugin({ hstsHeader: null, resolveAllowedCorsOrigin: async () => null }))
    .use(tenantMiddleware)
    .use(betterAuthPlugin)
    .get('/api/admin/system/info', { auth: true }, () => ({ success: true }))
    .get('/api/tenants/:tenantSlug/api/admin/entries', { auth: true }, () => ({ success: true }))
    .get('/api/tenants/:tenantSlug/api/public/entries', () => ({ success: true }))
}

function sessionFor(email: string, mfaVerified: boolean, role = 'viewer') {
  return {
    user: { id: `u-${email}`, name: email, email, role },
    session: { id: `s-${email}`, userId: `u-${email}`, mfaVerified },
  }
}

async function get(path: string, headers: Record<string, string> = {}) {
  const response = await buildApp().handle(new Request(`http://localhost${path}`, { headers }))
  const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null
  return { status: response.status, code: body?.error?.code }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockKvStore.clear()
  mockGetSession.mockResolvedValue(null)
  mockEnv.SUPER_ADMIN_REQUIRE_MFA = undefined
  tenantRow.requireMfa = false
})

describe('super-admin MFA requirement (SUPER_ADMIN_REQUIRE_MFA)', () => {
  it('blocks a super-admin session without MFA when required', async () => {
    mockEnv.SUPER_ADMIN_REQUIRE_MFA = 'true'
    mockGetSession.mockResolvedValue(sessionFor('root@example.com', false))
    expect(await get('/api/admin/system/info')).toEqual({ status: 403, code: 'MFA_REQUIRED' })
    expect(await get('/api/tenants/acme/api/admin/entries')).toEqual({
      status: 403,
      code: 'MFA_REQUIRED',
    })
  })

  it('blocks super-admins by role as well as by email', async () => {
    mockEnv.SUPER_ADMIN_REQUIRE_MFA = 'true'
    mockGetSession.mockResolvedValue(sessionFor('other@example.com', false, 'superadmin'))
    expect((await get('/api/admin/system/info')).code).toBe('MFA_REQUIRED')
  })

  it('allows a super-admin session that completed MFA', async () => {
    mockEnv.SUPER_ADMIN_REQUIRE_MFA = 'true'
    mockGetSession.mockResolvedValue(sessionFor('root@example.com', true))
    expect((await get('/api/admin/system/info')).status).toBe(200)
  })

  it('does not require MFA when the setting is off (existing deployments)', async () => {
    mockGetSession.mockResolvedValue(sessionFor('root@example.com', false))
    expect((await get('/api/admin/system/info')).status).toBe(200)
  })

  it('blocks super-admin access tokens without the mfa claim', async () => {
    mockEnv.SUPER_ADMIN_REQUIRE_MFA = 'true'
    const withoutMfa = await createAccessToken({ sub: 'u-root', email: 'root@example.com', sa: true }, JWT_SECRET)
    const withMfa = await createAccessToken(
      { sub: 'u-root', email: 'root@example.com', sa: true, mfa: true },
      JWT_SECRET
    )
    expect((await get('/api/admin/system/info', { authorization: `Bearer ${withoutMfa}` })).code).toBe(
      'MFA_REQUIRED'
    )
    expect((await get('/api/admin/system/info', { authorization: `Bearer ${withMfa}` })).status).toBe(200)
    expect(mockGetSession).not.toHaveBeenCalled()
  })
})

describe('per-tenant MFA requirement', () => {
  it('blocks tenant admin routes for members without MFA', async () => {
    tenantRow.requireMfa = true
    mockGetSession.mockResolvedValue(sessionFor('editor@example.com', false))
    expect(await get('/api/tenants/acme/api/admin/entries')).toEqual({
      status: 403,
      code: 'MFA_REQUIRED',
    })
  })

  it('applies to super-admins on that tenant too', async () => {
    tenantRow.requireMfa = true
    mockGetSession.mockResolvedValue(sessionFor('root@example.com', false))
    expect((await get('/api/tenants/acme/api/admin/entries')).code).toBe('MFA_REQUIRED')
  })

  it('allows members whose session completed MFA', async () => {
    tenantRow.requireMfa = true
    mockGetSession.mockResolvedValue(sessionFor('editor@example.com', true))
    expect((await get('/api/tenants/acme/api/admin/entries')).status).toBe(200)
  })

  it('leaves tenants without the setting unchanged', async () => {
    mockGetSession.mockResolvedValue(sessionFor('editor@example.com', false))
    expect((await get('/api/tenants/acme/api/admin/entries')).status).toBe(200)
  })

  it('does not gate public reads', async () => {
    tenantRow.requireMfa = true
    mockGetSession.mockResolvedValue(sessionFor('editor@example.com', false))
    expect((await get('/api/tenants/acme/api/public/entries')).status).toBe(200)
  })

  it('blocks fast-path tenant tokens without the mfa claim', async () => {
    tenantRow.requireMfa = true
    const claims = {
      sub: 'u-1',
      role: 'editor',
      tid: 'tenant-1',
      tsl: 'acme',
      trl: 'admin',
      rv: 0,
      pv: 0,
      email: 'editor@example.com',
    }
    const withoutMfa = await createAccessToken(claims, JWT_SECRET)
    const withMfa = await createAccessToken({ ...claims, mfa: true }, JWT_SECRET)
    expect(
      (await get('/api/tenants/acme/api/admin/entries', { authorization: `Bearer ${withoutMfa}` }))
        .code
    ).toBe('MFA_REQUIRED')
    expect(
      (await get('/api/tenants/acme/api/admin/entries', { authorization: `Bearer ${withMfa}` }))
        .status
    ).toBe(200)
  })
})
