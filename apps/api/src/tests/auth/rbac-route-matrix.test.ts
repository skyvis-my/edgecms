/**
 * PL-03: role x route authorization matrix through the real request guard
 * (api-security plugin + tenant middleware), with stub handlers mounted at
 * the real tenant admin paths.
 *
 * Covers built-in tenant roles, a custom role with per-collection entry
 * grants, a custom role with an explicit webhooks grant, and the custom-role
 * slow path (session + membership lookup instead of an access token).
 */
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'

const JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'
const AUTH_SECRET = 'test-better-auth-secret-at-least-32'

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

const mockDb = {
  prepare: vi.fn(() => {
    throw new Error('unexpected raw D1 query in route matrix test')
  }),
} as unknown as D1Database

const mockEnv = {
  DB: mockDb,
  CACHE: mockKv,
  BETTER_AUTH_SECRET: AUTH_SECRET,
  JWT_HS256_SECRET: JWT_SECRET,
  JWT_ISSUER: undefined,
  JWT_AUDIENCE: undefined,
  JWT_REQUIRED_FOR_ADMIN: undefined,
  SUPER_ADMIN_EMAILS: undefined,
}

mock.module('cloudflare:workers', () => ({ env: mockEnv }))

const mockGetSession = vi.fn(async (): Promise<unknown> => null)
mock.module('@/auth/auth', () => {
  const createAuth = () => ({
    handler: () => new Response('Not Found', { status: 404 }),
    api: { getSession: mockGetSession },
  })
  return { createAuth, createAuthForEnv: createAuth }
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
const membershipRoles = new Map<string, string>()
const tenantsRepositoryMock = {
  tenantsRepository: {
    findBySlug: vi.fn(async () => mockTenantRow),
    findTenantUser: vi.fn(async (_db: unknown, _tenantId: string, userId: string) => {
      const role = membershipRoles.get(userId)
      return role ? { userId, tenantId: 'tenant-1', role } : undefined
    }),
    findMembershipRole: vi.fn(async (_db: unknown, userId: string) => membershipRoles.get(userId)),
  },
}
mock.module('@/tenants/tenants.repository', () => tenantsRepositoryMock)
mock.module('../../tenants/tenants.repository', () => tenantsRepositoryMock)
mock.module('@/tenants/tenants.service', () => ({
  tenantsService: {
    findByIdOrSlug: vi.fn(async () => ({ success: true, data: mockTenantRow })),
  },
}))

/** Stored role grants for custom roles (built-in roles never hit this). */
const CUSTOM_ROLE_GRANTS: Record<string, Array<{ subject: string; action: string }>> = {
  'blog-writer': [
    { subject: 'entry:blog', action: 'read' },
    { subject: 'entry:blog', action: 'create' },
    { subject: 'entry:blog', action: 'update' },
  ],
  'hook-manager': [{ subject: 'webhooks:*', action: 'manage' }],
  'role-manager': [{ subject: 'TenantAdminRoles', action: 'manage' }],
  'no-grants': [],
}
const mockGetEffectivePermissions = vi.fn(
  async (_db: unknown, _tenantId: string, roleName: string) => {
    const grants = CUSTOM_ROLE_GRANTS[roleName]
    if (!grants) return { success: false, error: { code: 'NOT_FOUND', message: 'no role' } }
    return { success: true, data: grants }
  }
)
const rbacServiceMock = { rbacService: { getEffectivePermissions: mockGetEffectivePermissions } }
mock.module('@/auth/rbac.service', () => rbacServiceMock)
mock.module('../../auth/rbac.service', () => rbacServiceMock)

const cacheBuster = Date.now()
const { createApiSecurityGuardPlugin } = await import(
  `../../auth/api-security.plugin?bypass=${cacheBuster}`
)
const { tenantMiddleware } = await import(`../../tenants/tenant.middleware?bypass=${cacheBuster}`)
const { betterAuthPlugin } = await import(`../../auth/auth.middleware?bypass=${cacheBuster}`)
const { createAccessToken } = await import(`../../auth/jwt?bypass=${cacheBuster}`)
const { createSignedCsrfToken } = await import(`../../auth/csrf.middleware?bypass=${cacheBuster}`)
const { getRequestContentAccess } = await import("../../auth/content-access")

const T = '/api/tenants/acme/api/admin'

async function contentAccessSummary(request: Request) {
  const access = await getRequestContentAccess(request)
  if (!access) return null
  return {
    createAny: access.canAll('create'),
    createBlog: access.can('create', 'blog'),
    createNews: access.can('create', 'news'),
    readBlog: access.can('read', 'blog'),
    deleteBlog: access.can('delete', 'blog'),
  }
}

function buildApp() {
  const security = createApiSecurityGuardPlugin({
    hstsHeader: null,
    resolveAllowedCorsOrigin: async () => null,
  })
  const ok = () => ({ success: true })
  return new Elysia()
    .use(security)
    .use(tenantMiddleware)
    .use(betterAuthPlugin)
    .get(`${T}/entries`, { auth: true }, ok)
    .post(`${T}/entries`, { auth: true }, ok)
    .post(`${T}/commands`, { auth: true }, async ({ request }) => ({
      success: true,
      access: await contentAccessSummary(request),
    }))
    .post(`${T}/collections`, { auth: true }, ok)
    .get(`${T}/webhooks`, { auth: true }, ok)
    .get(`${T}/webhooks/signing`, { auth: true }, ok)
    .get(`${T}/webhooks/:id`, { auth: true }, ok)
    .get(`${T}/webhooks/:id/deliveries`, { auth: true }, ok)
    .post(`${T}/webhooks`, { auth: true }, ok)
    .put(`${T}/webhooks/:id`, { auth: true }, ok)
    .delete(`${T}/webhooks/:id`, { auth: true }, ok)
    .post(`${T}/webhooks/:id/test`, { auth: true }, ok)
    .get(`${T}/roles`, { auth: true }, ok)
    .post(`${T}/roles`, { auth: true }, ok)
    .put(`${T}/roles/:id`, { auth: true }, ok)
    .delete(`${T}/roles/:id`, { auth: true }, ok)
    .put(`${T}/users/:id/role`, { auth: true }, ok)
    .delete(`${T}/assets/:id`, { auth: true }, ok)
    .delete(`${T}/assets/:id/permanent`, { auth: true }, ok)
    .post(`${T}/assets/gc`, { auth: true }, ok)
}

type Route = { method: string; path: string }
const ROUTES: Record<string, Route> = {
  'GET entries': { method: 'GET', path: `${T}/entries` },
  'POST entries': { method: 'POST', path: `${T}/entries` },
  'POST commands': { method: 'POST', path: `${T}/commands` },
  'POST collections': { method: 'POST', path: `${T}/collections` },
  'GET webhooks': { method: 'GET', path: `${T}/webhooks` },
  'GET webhooks/signing': { method: 'GET', path: `${T}/webhooks/signing` },
  'GET webhooks/:id': { method: 'GET', path: `${T}/webhooks/w1` },
  'GET webhooks/:id/deliveries': { method: 'GET', path: `${T}/webhooks/w1/deliveries` },
  'POST webhooks': { method: 'POST', path: `${T}/webhooks` },
  'PUT webhooks/:id': { method: 'PUT', path: `${T}/webhooks/w1` },
  'DELETE webhooks/:id': { method: 'DELETE', path: `${T}/webhooks/w1` },
  'POST webhooks/:id/test': { method: 'POST', path: `${T}/webhooks/w1/test` },
  'GET roles': { method: 'GET', path: `${T}/roles` },
  'POST roles': { method: 'POST', path: `${T}/roles` },
  'PUT roles/:id': { method: 'PUT', path: `${T}/roles/r1` },
  'DELETE roles/:id': { method: 'DELETE', path: `${T}/roles/r1` },
  'PUT users/:id/role': { method: 'PUT', path: `${T}/users/u1/role` },
  'DELETE assets/:id (soft)': { method: 'DELETE', path: `${T}/assets/a1` },
  'DELETE assets/:id/permanent': { method: 'DELETE', path: `${T}/assets/a1/permanent` },
  'POST assets/gc': { method: 'POST', path: `${T}/assets/gc` },
}

const A = 'allow'
const D = 'deny'
type Verdict = typeof A | typeof D

// Columns: viewer, member, editor, admin, owner, blog-writer, hook-manager, no-grants
const ROLES = ['viewer', 'member', 'editor', 'admin', 'owner', 'blog-writer', 'hook-manager', 'no-grants'] as const
const MATRIX: Record<keyof typeof ROUTES, Verdict[]> = {
  //                              viewer member editor admin owner blogW hookM none
  'GET entries': /*            */ [D, A, A, A, A, A, D, D],
  'POST entries': /*           */ [D, D, A, A, A, A, D, D],
  'POST commands': /*          */ [D, D, A, A, A, A, D, D],
  'POST collections': /*       */ [D, D, A, A, A, D, D, D],
  'GET webhooks': /*           */ [D, D, D, A, A, D, A, D],
  'GET webhooks/signing': /*   */ [D, A, A, A, A, D, D, D],
  'GET webhooks/:id': /*       */ [D, D, D, A, A, D, A, D],
  'GET webhooks/:id/deliveries': [D, D, D, A, A, D, A, D],
  'POST webhooks': /*          */ [D, D, D, A, A, D, A, D],
  'PUT webhooks/:id': /*       */ [D, D, D, A, A, D, A, D],
  'DELETE webhooks/:id': /*    */ [D, D, D, A, A, D, A, D],
  'POST webhooks/:id/test': /* */ [D, D, D, A, A, D, A, D],
  'GET roles': /*              */ [D, A, A, A, A, D, D, D],
  'POST roles': /*             */ [D, D, D, A, A, D, D, D],
  'PUT roles/:id': /*          */ [D, D, D, A, A, D, D, D],
  'DELETE roles/:id': /*       */ [D, D, D, A, A, D, D, D],
  'PUT users/:id/role': /*     */ [D, D, D, A, A, D, D, D],
  'DELETE assets/:id (soft)': [D, D, A, A, A, D, D, D],
  'DELETE assets/:id/permanent': [D, D, D, A, A, D, D, D],
  'POST assets/gc': /*         */ [D, D, D, A, A, D, D, D],
}

async function mintToken(tenantRole: string) {
  return createAccessToken(
    {
      sub: `u-${tenantRole}`,
      role: 'viewer',
      tid: 'tenant-1',
      tsl: 'acme',
      trl: tenantRole,
      rv: 0,
      pv: 0,
      email: `${tenantRole}@example.com`,
    },
    JWT_SECRET
  )
}

async function send(app: ReturnType<typeof buildApp>, route: Route, auth: { token?: string; cookie?: string }) {
  const headers: Record<string, string> = {}
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`
  const cookies: string[] = auth.cookie ? [auth.cookie] : []
  let body: string | undefined
  if (route.method !== 'GET') {
    const csrf = await createSignedCsrfToken(AUTH_SECRET)
    headers['x-csrf-token'] = csrf
    cookies.push(`csrf_token=${csrf}`)
    if (route.method === 'POST' || route.method === 'PUT') {
      headers['content-type'] = 'application/json'
      body = '{}'
    }
  }
  if (cookies.length > 0) headers.cookie = cookies.join('; ')
  return app.handle(new Request(`http://localhost${route.path}`, { method: route.method, headers, body }))
}

beforeEach(() => {
  mockKvStore.clear()
  membershipRoles.clear()
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue(null)
  mockGetEffectivePermissions.mockClear()
})

describe('PL-03 role x route matrix (access token path)', () => {
  for (const [routeName, verdicts] of Object.entries(MATRIX)) {
    ROLES.forEach((role, index) => {
      const expected = verdicts[index]
      it(`${role} -> ${routeName}: ${expected}`, async () => {
        const app = buildApp()
        const response = await send(app, ROUTES[routeName]!, { token: await mintToken(role) })
        if (expected === A) {
          expect(response.status).toBe(200)
        } else {
          expect(response.status).toBe(403)
          const body = (await response.json()) as { error?: { code?: string } }
          expect(body.error?.code).toBe('FORBIDDEN')
        }
      })
    })
  }
})

describe('PL-03 member role assignment needs owner/admin or an explicit grant', () => {
  it('allows a custom role with a TenantAdminRoles grant (token path)', async () => {
    const response = await send(buildApp(), ROUTES['PUT users/:id/role']!, {
      token: await mintToken('role-manager'),
    })
    expect(response.status).toBe(200)
  })

  it('denies the same route on the global admin path to tenant-only roles', async () => {
    const response = await send(
      buildApp().put('/api/admin/users/:id/role', () => ({ success: true })),
      { method: 'PUT', path: '/api/admin/users/u1/role' },
      { token: await mintToken('admin') }
    )
    expect(response.status).toBe(403)
  })
})

describe('PL-03 effective content access exposed to handlers', () => {
  it('gives editors unrestricted content access', async () => {
    const response = await send(buildApp(), ROUTES['POST commands']!, { token: await mintToken('editor') })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { access: Record<string, boolean> }
    expect(body.access).toEqual({
      createAny: true,
      createBlog: true,
      createNews: true,
      readBlog: true,
      deleteBlog: true,
    })
    // Built-in roles never read stored grants.
    expect(mockGetEffectivePermissions).not.toHaveBeenCalled()
  })

  it('limits a custom role to its granted collection and actions', async () => {
    const response = await send(buildApp(), ROUTES['POST commands']!, { token: await mintToken('blog-writer') })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { access: Record<string, boolean> }
    expect(body.access).toEqual({
      createAny: false,
      createBlog: true,
      createNews: false,
      readBlog: true,
      deleteBlog: false,
    })
  })
})

describe('PL-03 custom role on the session (slow) path', () => {
  function sessionFor(userId: string) {
    mockGetSession.mockResolvedValue({
      user: { id: userId, name: userId, email: `${userId}@example.com`, role: 'viewer', emailVerified: true },
      session: { id: `s-${userId}` },
    })
  }

  it('lets a custom-role member read entries and applies its grants', async () => {
    membershipRoles.set('u-writer', 'blog-writer')
    sessionFor('u-writer')
    const app = buildApp()

    const read = await send(app, ROUTES['GET entries']!, { cookie: 'better-auth.session_token=x' })
    expect(read.status).toBe(200)

    const command = await send(app, ROUTES['POST commands']!, { cookie: 'better-auth.session_token=x' })
    expect(command.status).toBe(200)
    const body = (await command.json()) as { access: Record<string, boolean> }
    expect(body.access.createBlog).toBe(true)
    expect(body.access.createNews).toBe(false)

    const hooks = await send(app, ROUTES['POST webhooks']!, { cookie: 'better-auth.session_token=x' })
    expect(hooks.status).toBe(403)
  })

  it('still denies an editor membership on webhooks, roles and permanent delete', async () => {
    membershipRoles.set('u-ed', 'editor')
    sessionFor('u-ed')
    const app = buildApp()
    for (const name of ['POST webhooks', 'POST roles', 'DELETE assets/:id/permanent', 'POST assets/gc'] as const) {
      const response = await send(app, ROUTES[name]!, { cookie: 'better-auth.session_token=x' })
      expect(response.status).toBe(403)
    }
    const command = await send(app, ROUTES['POST commands']!, { cookie: 'better-auth.session_token=x' })
    expect(command.status).toBe(200)
  })
})
