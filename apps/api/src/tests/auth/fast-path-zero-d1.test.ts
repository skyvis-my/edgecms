import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'

const JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'

const mockKvStore = new Map<string, string>()
const mockKv = {
  get: vi.fn(async (key: string) => mockKvStore.get(key) ?? null),
  put: vi.fn(async (key: string, value: string) => {
    mockKvStore.set(key, value)
  }),
  delete: vi.fn(async (key: string) => {
    mockKvStore.delete(key)
  }),
} as unknown as KVNamespace

const mockPrepare = vi.fn(() => {
  throw new Error('unexpected D1 query: fast path must perform zero D1 reads')
})
const mockDb = { prepare: mockPrepare } as unknown as D1Database

const mockEnv = {
  DB: mockDb,
  CACHE: mockKv,
  BETTER_AUTH_SECRET: 'test-better-auth-secret-at-least-32',
  JWT_HS256_SECRET: JWT_SECRET,
  JWT_ISSUER: undefined,
  JWT_AUDIENCE: undefined,
  JWT_REQUIRED_FOR_ADMIN: undefined,
  SUPER_ADMIN_EMAILS: undefined,
}

mock.module('cloudflare:workers', () => ({
  env: mockEnv,
}))

const mockGetSession = vi.fn(async (): Promise<unknown> => null)
const mockCreateAuth = vi.fn((..._args: unknown[]) => ({
  handler: () => new Response('Not Found', { status: 404 }),
  api: { getSession: mockGetSession },
}))
mock.module('@/auth/auth', () => {
  const authModule = {
    createAuth: (...args: unknown[]) => mockCreateAuth(...args),
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

const mockTenantRow = {
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  mediaUploadMaxBytes: 5 * 1024 * 1024,
  mediaUploadMaxDimension: 2048,
  mediaAllowedMimeTypes: ['image/png'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const mockFindBySlug = vi.fn(async () => mockTenantRow)
const mockFindTenantUser = vi.fn(async () => null)
const mockFindMembershipRole = vi.fn(async () => null)
const tenantsRepositoryMock = {
  tenantsRepository: {
    findBySlug: mockFindBySlug,
    findTenantUser: mockFindTenantUser,
    findMembershipRole: mockFindMembershipRole,
  },
}
mock.module('@/tenants/tenants.repository', () => tenantsRepositoryMock)
mock.module('../../tenants/tenants.repository', () => tenantsRepositoryMock)

const mockTenantsServiceFind = vi.fn(async () => {
  throw new Error('tenantsService must not be called on the fast path')
})
mock.module('@/tenants/tenants.service', () => ({
  tenantsService: { findByIdOrSlug: mockTenantsServiceFind },
}))

const mockGetEffectivePermissions = vi.fn(async () => ({ success: true, data: [] }))
const rbacServiceMock = {
  rbacService: { getEffectivePermissions: mockGetEffectivePermissions },
}
mock.module('@/auth/rbac.service', () => rbacServiceMock)
mock.module('../../auth/rbac.service', () => rbacServiceMock)

const cacheBuster = Date.now()
const { createApiSecurityGuardPlugin } = await import(
  `../../auth/api-security.plugin?bypass=${cacheBuster}`
)
const { tenantMiddleware } = await import(`../../tenants/tenant.middleware?bypass=${cacheBuster}`)
const { betterAuthPlugin } = await import(`../../auth/auth.middleware?bypass=${cacheBuster}`)
const { createAccessToken } = await import(`../../auth/jwt?bypass=${cacheBuster}`)
const { bumpAuthRevision } = await import(`../../auth/auth-revision?bypass=${cacheBuster}`)

function buildApp() {
  const security = createApiSecurityGuardPlugin({
    hstsHeader: null,
    resolveAllowedCorsOrigin: async () => null,
  })
  return new Elysia()
    .use(security)
    .use(tenantMiddleware)
    .use(betterAuthPlugin)
    .get(
      '/api/tenants/:tenantSlug/api/admin/entries',
      { auth: true },
      ({ user }) => ({ success: true, userId: (user as { id: string }).id })
    )
    .get('/api/me', { auth: true }, ({ user }) => ({ id: (user as { id: string }).id }))
}

function mintFreshToken() {
  return createAccessToken(
    {
      sub: 'u-1',
      role: 'editor',
      tid: 'tenant-1',
      tsl: 'acme',
      trl: 'editor',
      rv: 0,
      pv: 0,
      email: 'u@example.com',
    },
    JWT_SECRET
  )
}

describe('stateless RBAC fast path: zero D1 session/membership reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockKvStore.clear()
    mockGetSession.mockResolvedValue(null)
  })

  it('serves an authenticated tenant admin route with 0 session/membership D1 queries', async () => {
    const app = buildApp()
    const token = await mintFreshToken()

    const response = await app.handle(
      new Request('http://localhost/api/tenants/acme/api/admin/entries', {
        headers: { Authorization: `Bearer ${token}` },
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { success?: boolean; userId?: string }
    expect(body).toMatchObject({ success: true, userId: 'u-1' })

    // Session source of truth never consulted…
    expect(mockCreateAuth).not.toHaveBeenCalled()
    expect(mockGetSession).not.toHaveBeenCalled()
    // …membership never re-resolved from D1…
    expect(mockFindTenantUser).not.toHaveBeenCalled()
    expect(mockFindMembershipRole).not.toHaveBeenCalled()
    expect(mockTenantsServiceFind).not.toHaveBeenCalled()
    expect(mockGetEffectivePermissions).not.toHaveBeenCalled()
    // …and no raw D1 query ran at all (tenant row is mocked above the driver).
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('HS-04: locks a suspended tenant admin route for a valid member token', async () => {
    const app = buildApp()
    const token = await mintFreshToken()
    mockFindBySlug.mockResolvedValueOnce({ ...mockTenantRow, status: 'suspended' })

    const response = await app.handle(
      new Request('http://localhost/api/tenants/acme/api/admin/entries', {
        headers: { Authorization: `Bearer ${token}` },
      })
    )

    expect(response.status).toBe(403)
    const body = (await response.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('TENANT_SUSPENDED')
  })

  it('still rejects stale tokens with TOKEN_STALE (never downgrades to DB)', async () => {
    const app = buildApp()
    const nowSeconds = Math.floor(Date.now() / 1000)
    const aged = await createAccessToken(
      {
        sub: 'u-1',
        role: 'editor',
        tid: 'tenant-1',
        tsl: 'acme',
        trl: 'editor',
        rv: 0,
        pv: 0,
      },
      JWT_SECRET,
      { ttlSeconds: 600, issuedAtSeconds: nowSeconds - 120 }
    )
    await bumpAuthRevision(mockKv, 'u-1', 'tenant-1')

    const response = await app.handle(
      new Request('http://localhost/api/tenants/acme/api/admin/entries', {
        headers: { Authorization: `Bearer ${aged}` },
      })
    )

    expect(response.status).toBe(401)
    const body = (await response.json()) as { success?: boolean; error?: { code?: string } }
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('TOKEN_STALE')
    expect(mockCreateAuth).not.toHaveBeenCalled()
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockFindTenantUser).not.toHaveBeenCalled()
  })

  it('keeps /api/me on the D1 session source of truth', async () => {
    const app = buildApp()
    const token = await mintFreshToken()
    mockGetSession.mockResolvedValue({
      user: { id: 'u-1', name: 'U', email: 'u@example.com', role: 'viewer' },
      session: { id: 's-1' },
    })

    const response = await app.handle(
      new Request('http://localhost/api/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
    )

    expect(response.status).toBe(200)
    const meBody = (await response.json()) as { id?: string }
    expect(meBody.id).toBe('u-1')
    expect(mockCreateAuth).toHaveBeenCalled()
    expect(mockGetSession).toHaveBeenCalled()
  })
})
