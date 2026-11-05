/**
 * DL-08: preview token minting and verification through the real request
 * guard (api-security plugin + tenant middleware) and the real public
 * controller. Adversarial cases: anonymous minting, cross-tenant minting,
 * minting for content the caller cannot read, caching, and using a preview
 * token as a write credential.
 */
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'

const JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!'
const AUTH_SECRET = 'test-better-auth-secret-at-least-32'
const PREVIEW_SECRET = 'test-preview-secret-at-least-32-chars'

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
    throw new Error('unexpected raw D1 query in preview token route test')
  }),
} as unknown as D1Database

const mockEnv: Record<string, unknown> = {
  DB: mockDb,
  CACHE: mockKv,
  BETTER_AUTH_SECRET: AUTH_SECRET,
  PREVIEW_SECRET,
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
const tenantsRepositoryMock = {
  tenantsRepository: {
    findBySlug: vi.fn(async () => mockTenantRow),
    findTenantUser: vi.fn(async () => undefined),
    findMembershipRole: vi.fn(async () => undefined),
  },
}
mock.module('@/tenants/tenants.repository', () => tenantsRepositoryMock)
mock.module('../../tenants/tenants.repository', () => tenantsRepositoryMock)
mock.module('@/tenants/tenants.service', () => ({
  tenantsService: {
    findByIdOrSlug: vi.fn(async () => ({ success: true, data: mockTenantRow })),
  },
}))

/** A custom role that passes the admin-mutation guard but reads only `blog`. */
const CUSTOM_ROLE_GRANTS: Record<string, Array<{ subject: string; action: string }>> = {
  'blog-previewer': [
    { subject: 'TenantAdminApi', action: 'mutate' },
    { subject: 'entry:blog', action: 'read' },
  ],
}
const rbacServiceMock = {
  rbacService: {
    getEffectivePermissions: vi.fn(async (_db: unknown, _tenantId: string, roleName: string) => {
      const grants = CUSTOM_ROLE_GRANTS[roleName]
      if (!grants) return { success: false, error: { code: 'NOT_FOUND', message: 'no role' } }
      return { success: true, data: grants }
    }),
  },
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
const { createSignedCsrfToken } = await import(`../../auth/csrf.middleware?bypass=${cacheBuster}`)
const { publicController } = await import(`../../public/public.controller?bypass=${cacheBuster}`)
const { verifyPreviewToken, generatePreviewToken } = await import('../../public/preview-token')

let commandsHit = 0

function buildApp() {
  const security = createApiSecurityGuardPlugin({
    hstsHeader: null,
    resolveAllowedCorsOrigin: async () => null,
  })
  return new Elysia()
    .use(security)
    .use(publicController)
    .group('/api/tenants/:tenantSlug', (app) =>
      app
        .use(tenantMiddleware)
        .use(betterAuthPlugin)
        .use(publicController)
        .post('/api/admin/commands', { auth: true }, () => {
          commandsHit++
          return { success: true }
        })
    )
}

async function accessToken(tenantRole: string) {
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

async function post(path: string, body: unknown, opts: { token?: string } = {}) {
  const csrf = await createSignedCsrfToken(AUTH_SECRET)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-csrf-token': csrf,
    cookie: `csrf_token=${csrf}`,
  }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  return buildApp().handle(
    new Request(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  )
}

const MINT = '/api/tenants/acme/api/public/preview-token'

beforeEach(() => {
  mockKvStore.clear()
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue(null)
  mockEnv.PREVIEW_SECRET = PREVIEW_SECRET
  mockEnv.BETTER_AUTH_SECRET = AUTH_SECRET
  commandsHit = 0
})

describe('DL-08 preview token minting', () => {
  it('refuses anonymous minting on the tenant route', async () => {
    const res = await post(MINT, { collectionSlug: 'blog' })
    expect(res.status).toBe(401)
  })

  it('refuses anonymous minting on the global route, even with a tenantSlug in the body', async () => {
    const res = await post('/api/public/preview-token', { tenantSlug: 'acme', collectionSlug: 'blog' })
    expect(res.status).not.toBe(200)
    const json = (await res.json()) as { token?: string }
    expect(json.token).toBeUndefined()
  })

  it('refuses members without write access to the admin API', async () => {
    const res = await post(MINT, { collectionSlug: 'blog' }, { token: await accessToken('member') })
    expect(res.status).toBe(403)
  })

  it('binds the token to the request tenant and the issuing user, never the body tenantSlug', async () => {
    const res = await post(
      MINT,
      { tenantSlug: 'other-tenant', collectionSlug: 'blog', entrySlug: 'hello' },
      { token: await accessToken('editor') }
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { token: string; tenantSlug: string }
    expect(json.tenantSlug).toBe('acme')
    const verified = await verifyPreviewToken(json.token, PREVIEW_SECRET)
    expect(verified.valid).toBe(true)
    if (verified.valid) {
      expect(verified.payload.tenantSlug).toBe('acme')
      expect(verified.payload.sub).toBe('u-editor')
      expect(verified.payload.collectionSlug).toBe('blog')
    }
  })

  it('is never cached: the token response is no-store', async () => {
    const res = await post(MINT, { collectionSlug: 'blog' }, { token: await accessToken('editor') })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('sends Referrer-Policy: no-referrer so the token page never leaks a Referer', async () => {
    const res = await post(MINT, { collectionSlug: 'blog' }, { token: await accessToken('editor') })
    expect(res.status).toBe(200)
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    const denied = await post(MINT, { collectionSlug: 'news' }, { token: await accessToken('blog-previewer') })
    expect(denied.status).toBe(403)
    expect(denied.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('refuses a token for a collection the caller cannot read (PL-03 grants)', async () => {
    const token = await accessToken('blog-previewer')
    const denied = await post(MINT, { collectionSlug: 'news' }, { token })
    expect(denied.status).toBe(403)
    const tenantWide = await post(MINT, {}, { token })
    expect(tenantWide.status).toBe(403)
    const allowed = await post(MINT, { collectionSlug: 'blog' }, { token })
    expect(allowed.status).toBe(200)
  })

  it('refuses to mint when no signing secret is configured (no built-in default)', async () => {
    mockEnv.PREVIEW_SECRET = undefined
    mockEnv.BETTER_AUTH_SECRET = undefined
    const csrfSecretless = await post(MINT, { collectionSlug: 'blog' }, { token: await accessToken('editor') })
    // Without BETTER_AUTH_SECRET the CSRF check may refuse first; either way no token.
    expect(csrfSecretless.status).not.toBe(200)
    const json = (await csrfSecretless.json()) as { token?: string }
    expect(json.token).toBeUndefined()
  })
})

describe('DL-08 preview token verification', () => {
  it('verify responses are no-store', async () => {
    const minted = await generatePreviewToken({ tenantSlug: 'acme', issuerId: 'u1', secret: PREVIEW_SECRET })
    const res = await post(
      '/api/tenants/acme/api/public/preview-token/verify',
      { token: minted.token },
      { token: await accessToken('editor') }
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('rejects a token minted for another tenant', async () => {
    const minted = await generatePreviewToken({ tenantSlug: 'globex', issuerId: 'u1', secret: PREVIEW_SECRET })
    const res = await post(
      '/api/tenants/acme/api/public/preview-token/verify',
      { token: minted.token, tenantSlug: 'globex' },
      { token: await accessToken('editor') }
    )
    expect(res.status).toBe(401)
  })
})

describe('DL-08 preview tokens are never write credentials', () => {
  it('a preview token as a bearer credential cannot run commands', async () => {
    const minted = await generatePreviewToken({
      tenantSlug: 'acme',
      issuerId: 'u-editor',
      collectionSlug: 'blog',
      secret: PREVIEW_SECRET,
    })
    const res = await post('/api/tenants/acme/api/admin/commands', { type: 'createEntry' }, { token: minted.token })
    expect(res.status).toBe(401)
    expect(commandsHit).toBe(0)
  })
})
