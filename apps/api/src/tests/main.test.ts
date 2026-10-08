import { afterAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { createSignedCsrfToken } from '@/auth/csrf.middleware'
import { __resetRateLimitState } from '@/auth/rate-limit.middleware'
import { __resetCorsCacheForTests } from '@/tenants/cors-cache'
import { __resetParsedOriginsCacheForTests } from '@/app'
import type { Env } from '@/env'

const mockCreateAuth = vi.fn()
const mockFindTenantByIdOrSlug = vi.fn()

function createMockDB(): D1Database {
  const stmt = {
    bind: vi.fn(() => stmt),
    first: vi.fn(async () => ({ ok: 1 })),
    all: vi.fn(async () => ({ results: [] })),
    run: vi.fn(async () => ({ success: true })),
  }

  return {
    prepare: vi.fn(() => stmt),
  } as unknown as D1Database
}

function createMockKV(): KVNamespace {
  return {
    get: vi.fn(async () => null),
  } as unknown as KVNamespace
}

const mockWorkerEnv: Env = {
  DB: createMockDB(),
  CACHE: createMockKV(),
  MEDIA: {} as R2Bucket,
  ASSETS: {
    fetch: vi.fn(),
  } as unknown as Fetcher,
  PUBLISH_SCHEDULER: {} as DurableObjectNamespace,
  WEBHOOK_QUEUE: {} as Queue,
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters',
  JWT_HS256_SECRET: undefined as string | undefined,
  JWT_ISSUER: undefined as string | undefined,
  JWT_AUDIENCE: undefined as string | undefined,
  JWT_REQUIRED_FOR_ADMIN: undefined as string | undefined,
  EDGE_PLUGINS_JSON: undefined as string | undefined,
  EDGE_PLUGIN_HOOK_TIMEOUT_MS: undefined as string | undefined,
}

mock.module('cloudflare:workers', () => ({
  env: mockWorkerEnv,
}))

mock.module('@/auth/auth', () => ({
  createAuth: mockCreateAuth,
}))

mock.module('@/tenants/tenants.service', () => ({
  tenantsService: {
    findByIdOrSlug: mockFindTenantByIdOrSlug,
  },
}))

type AppInstance = {
  handle: (request: Request) => Promise<Response>
}

type WorkerAppInstance = AppInstance & {
  fetch: unknown
  queue: unknown
}

let importCounter = 0

function nextImportId(): string {
  importCounter += 1
  return `${Date.now()}-${importCounter}`
}

async function importMain(): Promise<WorkerAppInstance> {
  const module = await import(`@/main?bypass=${nextImportId()}`)
  return module.default as WorkerAppInstance
}

async function importApp(): Promise<AppInstance> {
  const module = await import(`@/app?bypass=${nextImportId()}`)
  return module.createApp() as AppInstance
}

async function importAppModule() {
  return import(`@/app?bypass=${nextImportId()}`)
}

async function signedCsrfHeaders(): Promise<Record<string, string>> {
  const token = await createSignedCsrfToken(mockWorkerEnv.BETTER_AUTH_SECRET!)
  return {
    'x-csrf-token': token,
    cookie: `csrf_token=${token}`,
  }
}

function buildMockAuth(sessionResult: unknown) {
  const handler = vi.fn((request: Request) => {
    void request
    return new Response('Not Found', { status: 404 })
  })
  const getSession = vi.fn(async () => sessionResult)

  mockCreateAuth.mockImplementation(() => ({
    handler,
    api: {
      getSession,
    },
  }))

  return { handler, getSession }
}

function buildHeaderAwareMockAuth(
  resolver: (requestHeaders: Headers) => unknown | Promise<unknown>
) {
  const handler = vi.fn((request: Request) => {
    void request
    return new Response('Not Found', { status: 404 })
  })
  const getSession = vi.fn(async ({ headers }: { headers: Headers }) => resolver(headers))

  mockCreateAuth.mockImplementation(() => ({
    handler,
    api: {
      getSession,
    },
  }))

  return { handler, getSession }
}

function mockTenantRole(tenantRole: string | null) {
  mockWorkerEnv.DB = {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('FROM tenant_users')) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn(async () => (tenantRole ? { role: tenantRole } : null)),
          })),
        }
      }
      return {
        first: vi.fn(async () => ({ id: null })),
      }
    }),
  } as unknown as D1Database
}

function toBase64UrlJson(value: unknown): string {
  const json = JSON.stringify(value)
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function createHs256Jwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const headerPart = toBase64UrlJson({ alg: 'HS256', typ: 'JWT' })
  const payloadPart = toBase64UrlJson(payload)
  const signingInput = `${headerPart}.${payloadPart}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  const signaturePart = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `${headerPart}.${payloadPart}.${signaturePart}`
}

describe('Main API app (Elysia integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetRateLimitState()
    __resetCorsCacheForTests()
    mockWorkerEnv.EDGE_PLUGINS_JSON = undefined
    mockWorkerEnv.EDGE_PLUGIN_HOOK_TIMEOUT_MS = undefined
    mockWorkerEnv.JWT_HS256_SECRET = undefined
    mockWorkerEnv.JWT_ISSUER = undefined
    mockWorkerEnv.JWT_AUDIENCE = undefined
    mockWorkerEnv.JWT_REQUIRED_FOR_ADMIN = undefined
    mockWorkerEnv.CORS_ALLOWED_ORIGINS = undefined
    mockWorkerEnv.ADMIN_CORS_ALLOWED_ORIGINS = undefined
    mockWorkerEnv.PUBLIC_CORS_ALLOWED_ORIGINS = undefined
    mockWorkerEnv.BASE_URL = undefined
    mockWorkerEnv.HSTS_MAX_AGE_SECONDS = undefined
    mockWorkerEnv.HSTS_INCLUDE_SUBDOMAINS = undefined
    mockWorkerEnv.HSTS_PRELOAD = undefined
    mockWorkerEnv.SUPER_ADMIN_EMAILS = undefined
    buildMockAuth(null)
    mockFindTenantByIdOrSlug.mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'not found' },
    })
  })

  afterAll(() => {
    mock.restore()
  })

  it('imports main app without route registration errors', async () => {
    const worker = await importMain()
    expect(typeof worker.fetch).toBe('function')
    expect(typeof worker.handle).toBe('function')
    expect(typeof worker.queue).toBe('function')
  })

  it('applies plugin hook timeout from EDGE_PLUGIN_HOOK_TIMEOUT_MS', async () => {
    mockWorkerEnv.EDGE_PLUGIN_HOOK_TIMEOUT_MS = '375'
    const { pluginRegistry } = await import('@/plugins/plugin-registry')
    pluginRegistry.clear()

    await importAppModule()

    expect(pluginRegistry.getHookTimeoutMs()).toBe(375)
  })

  it('ignores invalid plugin hook timeout config and keeps default', async () => {
    mockWorkerEnv.EDGE_PLUGIN_HOOK_TIMEOUT_MS = 'not-a-number'
    const { pluginRegistry } = await import('@/plugins/plugin-registry')
    pluginRegistry.clear()

    await importAppModule()

    expect(pluginRegistry.getHookTimeoutMs()).toBe(250)
  })

  it('serves health endpoint via app.handle(Request)', async () => {
    const app = await importApp()
    const response = await app.handle(new Request('http://localhost/api/health'))

    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      status: string
      timestamp: string
      subsystems: {
        database: { status: string }
        cache: { status: string }
        media: { status: string }
        assets: { status: string }
        scheduler: { status: string }
        webhooks: { status: string }
      }
    }

    expect(body.status).toBe('ok')
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
    expect(body.subsystems.database.status).toBe('ok')
    expect(body.subsystems.cache.status).toBe('ok')
    expect(body.subsystems.media.status).toBe('ok')
    expect(body.subsystems.assets.status).toBe('ok')
    expect(body.subsystems.scheduler.status).toBe('ok')
    expect(body.subsystems.webhooks.status).toBe('ok')
  })

  it('serves the scoped OpenAPI docs route without admin auth', async () => {
    const app = await importApp()
    const response = await app.handle(new Request('http://localhost/api/docs'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('serves API root health endpoint with per-subsystem status', async () => {
    const app = await importApp()
    const response = await app.handle(new Request('http://localhost/api'))

    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      status: string
      timestamp: string
      subsystems: Record<string, { status: string }>
    }

    expect(body.status).toBe('ok')
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
    expect(body.subsystems.database?.status).toBe('ok')
    expect(body.subsystems.cache?.status).toBe('ok')
    expect(body.subsystems.media?.status).toBe('ok')
    expect(body.subsystems.assets?.status).toBe('ok')
    expect(body.subsystems.scheduler?.status).toBe('ok')
    expect(body.subsystems.webhooks?.status).toBe('ok')
  })

  it('returns 401 for protected endpoint without session', async () => {
    const app = await importApp()
    const response = await app.handle(new Request('http://localhost/api/me'))

    expect(response.status).toBe(401)
  })

  it('returns user profile for protected endpoint with valid session', async () => {
    const app = await importApp()
    buildMockAuth({
      user: {
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        role: 'admin',
      },
      session: {
        id: 'session-123',
      },
    })

    const response = await app.handle(new Request('http://localhost/api/me'))

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toEqual({
      id: 'user-123',
      name: 'Test User',
      email: 'test@example.com',
      role: 'admin',
    })
  })

  it('returns effective superadmin role from /api/me when email is configured', async () => {
    const app = await importApp()
    mockWorkerEnv.SUPER_ADMIN_EMAILS = 'test@example.com'
    buildMockAuth({
      user: {
        id: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        role: 'viewer',
      },
      session: {
        id: 'session-123',
      },
    })

    const response = await app.handle(new Request('http://localhost/api/me'))

    expect(response.status).toBe(200)

    const body = (await response.json()) as { role: string }
    expect(body.role).toBe('superadmin')
  })

  it('forwards mounted auth route with /api/auth prefix preserved', async () => {
    const app = await importApp()
    const { handler } = buildMockAuth(null)

    await app.handle(new Request('http://localhost/api/auth/sign-in?next=/admin'))

    expect(handler).toHaveBeenCalledTimes(1)

    const firstCall = handler.mock.calls[0]
    expect(firstCall).toBeDefined()
    if (!firstCall) {
      throw new Error('Expected auth handler call')
    }
    const forwardedRequest = firstCall[0]
    expect(forwardedRequest.url).toBe('http://localhost/api/auth/sign-in?next=/admin')
  })

  it('registers assets upload route exactly once', async () => {
    const app = await importApp()
    const routeSignatures = (
      (app as { router?: { history?: Array<{ method: string; path: string }> } }).router?.history ??
      []
    ).map((route) => `${route.method} ${route.path}`)
    const uploadRouteCount = routeSignatures.filter(
      (signature) => signature === 'POST /api/admin/assets/upload'
    ).length

    expect(uploadRouteCount).toBe(1)
  })

  it('registers trusted plugin routes when EDGE_PLUGINS_JSON enables them', async () => {
    mockWorkerEnv.EDGE_PLUGINS_JSON = JSON.stringify([{ name: 'audit-trace', enabled: true }])
    const appModule = await importAppModule()
    const app = appModule.createApp() as AppInstance & {
      router?: { history?: Array<{ method: string; path: string }> }
    }

    const routeSignatures = (
      app.router?.history ?? []
    ).map((route) => `${route.method} ${route.path}`)

    expect(routeSignatures).toContain('GET /api/admin/plugins/audit-trace/health')
  })

  it('supports tenant-scoped canonical paths without internal /api segment', async () => {
    const app = await importApp()

    const canonicalPathResponse = await app.handle(
      new Request('http://localhost/api/tenants/acme/admin/sync/stream')
    )
    const internalPathResponse = await app.handle(
      new Request('http://localhost/api/tenants/acme/api/admin/sync/stream')
    )

    expect(canonicalPathResponse.status).toBe(internalPathResponse.status)
    expect(canonicalPathResponse.status).not.toBe(404)
  })

  it('rejects forged role header on admin mutation without valid session', async () => {
    const app = await importApp()
    buildMockAuth(null)

    const response = await app.handle(
      new Request('http://localhost/api/admin/commands', {
        method: 'POST',
        headers: {
          ...(await signedCsrfHeaders()),
          'x-edge-role': 'admin',
          'x-edge-actor-id': 'forged-user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'entry.create',
          payload: {},
          actor: { userId: 'forged-user', source: 'admin' },
        }),
      })
    )

    expect([400, 401, 403, 422]).toContain(response.status)
  })

  it('returns 415 for unsupported content type on API mutations with payload', async () => {
    const app = await importApp()

    const response = await app.handle(
      new Request('http://localhost/api/admin/commands', {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
        },
        body: 'invalid content type payload',
      })
    )

    expect(response.status).toBe(415)
    const body = (await response.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('returns structured NOT_FOUND envelope for unknown API routes', async () => {
    const app = await importApp()

    const response = await app.handle(new Request('http://localhost/api/unknown-route'))

    expect(response.status).toBe(404)
    const body = (await response.json()) as {
      success?: boolean
      error?: { code?: string; message?: string }
    }
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe('NOT_FOUND')
  })

  it('allows tenant-scoped admin mutations when user has tenant editor role', async () => {
    const app = await importApp()
    mockTenantRole('editor')
    buildMockAuth({
      user: {
        id: 'tenant-user-1',
        name: 'Tenant User',
        email: 'tenant-user@example.com',
      },
      session: {
        id: 'session-tenant-user-1',
      },
    })

    const response = await app.handle(
      new Request('http://localhost/api/tenants/acme/admin/commands', {
        method: 'POST',
        headers: {
          ...(await signedCsrfHeaders()),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'entry.create',
          payload: {},
          actor: { userId: 'tenant-user-1', source: 'admin' },
        }),
      })
    )

    expect(response.status).not.toBe(403)
  })

  it('forbids viewer role from reading admin webhook listings', async () => {
    const app = await importApp()
    buildMockAuth({
      user: {
        id: 'viewer-1',
        name: 'Viewer User',
        email: 'viewer@example.com',
        role: 'viewer',
      },
      session: {
        id: 'session-viewer-1',
      },
    })

    const response = await app.handle(new Request('http://localhost/api/admin/webhooks'))

    expect(response.status).toBe(403)
    const body = (await response.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('FORBIDDEN')
  })

  it('rejects tenant CORS origin on tenant admin preflight', async () => {
    const app = await importApp()
    mockFindTenantByIdOrSlug.mockResolvedValue({
      success: true,
      data: {
        id: 'tenant-1',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        localeCatalog: ['en'],
        targetUrl: 'https://upstream.example.com',
        corsOrigin: 'https://admin.acme.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })

    const response = await app.handle(
      new Request('http://localhost/api/tenants/acme/admin/entries', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://admin.acme.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-csrf-token',
        },
      })
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(mockFindTenantByIdOrSlug).not.toHaveBeenCalled()
  })

  it('returns cacheable tenant-specific CORS preflight response for tenant public API', async () => {
    const app = await importApp()
    mockFindTenantByIdOrSlug.mockResolvedValue({
      success: true,
      data: {
        id: 'tenant-1',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        localeCatalog: ['en'],
        targetUrl: 'https://upstream.example.com',
        corsOrigin: 'https://public.acme.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })

    const response = await app.handle(
      new Request('http://localhost/api/tenants/acme/public/entries', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://public.acme.com',
          'access-control-request-method': 'GET',
        },
      })
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://public.acme.com')
    expect(response.headers.get('access-control-max-age')).toBe('86400')
    expect(response.headers.get('cache-control')).toContain('max-age=86400')
  })

  it('matches tenant CORS origin with trailing slashes, subpaths, and comma-separated lists', async () => {
    const app = await importApp()
    mockFindTenantByIdOrSlug.mockResolvedValue({
      success: true,
      data: {
        id: 'tenant-1',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        localeCatalog: ['en'],
        targetUrl: 'https://upstream.example.com',
        corsOrigin: 'https://preview.acme.com/site/, https://PUBLIC.ACME.COM///',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })

    // First origin in comma-separated list with subpath
    const previewRes = await app.handle(
      new Request('http://localhost/api/tenants/acme/public/entries', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://preview.acme.com',
          'access-control-request-method': 'GET',
        },
      })
    )
    expect(previewRes.status).toBe(204)
    expect(previewRes.headers.get('access-control-allow-origin')).toBe('https://preview.acme.com')

    // Second origin with uppercase and multiple trailing slashes
    const publicRes = await app.handle(
      new Request('http://localhost/api/tenants/acme/public/entries', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://public.acme.com',
          'access-control-request-method': 'GET',
        },
      })
    )
    expect(publicRes.status).toBe(204)
    expect(publicRes.headers.get('access-control-allow-origin')).toBe('https://public.acme.com')

    // Unmatched origin rejected
    const rejectedRes = await app.handle(
      new Request('http://localhost/api/tenants/acme/public/entries', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://malicious.evil.com',
          'access-control-request-method': 'GET',
        },
      })
    )
    expect(rejectedRes.status).toBe(204)
    expect(rejectedRes.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows configured admin CORS origins for admin preflight', async () => {
    mockWorkerEnv.ADMIN_CORS_ALLOWED_ORIGINS = 'https://admin.edgecms.test'
    const app = await importApp()

    const response = await app.handle(
      new Request('http://localhost/api/admin/entries', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://admin.edgecms.test',
          'access-control-request-method': 'POST',
        },
      })
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://admin.edgecms.test')
  })

  it('ignores blank entries in configured CORS origin lists', async () => {
    mockWorkerEnv.ADMIN_CORS_ALLOWED_ORIGINS = 'https://admin.edgecms.test, '
    const app = await importApp()

    const response = await app.handle(
      new Request('http://localhost/api/admin/entries', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://admin.edgecms.test',
          'access-control-request-method': 'POST',
        },
      })
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://admin.edgecms.test')
  })

  it('rejects admin origins on global public API unless public CORS allows them', async () => {
    mockWorkerEnv.ADMIN_CORS_ALLOWED_ORIGINS = 'https://admin.edgecms.test'
    const app = await importApp()

    const response = await app.handle(
      new Request('http://localhost/api/public/articles', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://admin.edgecms.test',
          'access-control-request-method': 'GET',
        },
      })
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('sets HSTS on HTTPS responses when configured', async () => {
    mockWorkerEnv.HSTS_MAX_AGE_SECONDS = '31536000'
    mockWorkerEnv.HSTS_INCLUDE_SUBDOMAINS = 'true'
    mockWorkerEnv.HSTS_PRELOAD = 'true'
    const app = await importApp()

    const response = await app.handle(new Request('https://localhost/api/health'))

    expect(response.headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains; preload'
    )
  })

  it('sets API security headers on local route responses', async () => {
    const app = await importApp()

    const response = await app.handle(new Request('http://localhost/api/health'))

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=()'
    )
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'"
    )
  })

  it('omits HSTS on HTTP responses', async () => {
    mockWorkerEnv.HSTS_MAX_AGE_SECONDS = '31536000'
    const app = await importApp()

    const response = await app.handle(new Request('http://localhost/api/health'))

    expect(response.headers.get('strict-transport-security')).toBeNull()
  })

  it('rejects invalid HSTS max-age configuration', async () => {
    mockWorkerEnv.HSTS_MAX_AGE_SECONDS = '-1'
    await expect(importApp()).rejects.toThrow(
      'HSTS_MAX_AGE_SECONDS must be a non-negative integer'
    )
  })

  it('rejects HSTS preload without includeSubDomains and long max-age', async () => {
    mockWorkerEnv.HSTS_MAX_AGE_SECONDS = '300'
    mockWorkerEnv.HSTS_PRELOAD = 'true'
    await expect(importApp()).rejects.toThrow(
      'HSTS_PRELOAD requires HSTS_INCLUDE_SUBDOMAINS=true and HSTS_MAX_AGE_SECONDS >= 31536000'
    )
  })

  it('uses per-user rate-limit buckets for authenticated reads', async () => {
    const app = await importApp()
    buildHeaderAwareMockAuth((headers) => {
      const actorId = headers.get('x-test-user') ?? 'user-default'
      return {
        user: { id: actorId, name: 'Rate User', email: `${actorId}@example.com`, role: 'viewer' },
        session: { id: `session-${actorId}` },
      }
    })

    for (let i = 0; i < 120; i++) {
      const userA = await app.handle(
        new Request('http://localhost/api/me', { headers: { 'x-test-user': 'user-a' } })
      )
      expect(userA.status).toBe(200)
    }

    // Must still pass for user-b if bucket key includes actor identity.
    const userB = await app.handle(
      new Request('http://localhost/api/me', { headers: { 'x-test-user': 'user-b' } })
    )
    expect(userB.status).toBe(200)
  })

  it('uses shared anonymous rate-limit bucket when no actor exists', async () => {
    const app = await importApp()
    buildMockAuth(null)

    let lastStatus = 200
    for (let i = 0; i < 121; i++) {
      const response = await app.handle(new Request('http://localhost/api/admin/entries'))
      lastStatus = response.status
    }

    expect(lastStatus).toBe(429)
  })

  it('rate-limits invalid CSRF attempts before returning CSRF errors', async () => {
    const app = await importApp()
    buildMockAuth(null)

    for (let i = 0; i < 60; i++) {
      const response = await app.handle(
        new Request('http://localhost/api/admin/commands', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'createEntry',
            payload: {},
            actor: { userId: 'invalid-csrf-user', source: 'admin' },
            timestamp: '2026-06-01T00:00:00.000Z',
          }),
        })
      )
      expect(response.status).toBe(403)
    }

    const blocked = await app.handle(
      new Request('http://localhost/api/admin/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'createEntry',
          payload: {},
          actor: { userId: 'invalid-csrf-user', source: 'admin' },
          timestamp: '2026-06-01T00:00:00.000Z',
        }),
      })
    )

    expect(blocked.status).toBe(429)
  })

  it('rejects malformed bearer JWT when JWT validation is configured', async () => {
    mockWorkerEnv.JWT_HS256_SECRET = 'jwt-secret'
    const app = await importApp()

    const response = await app.handle(
      new Request('http://localhost/api/admin/entries', {
        headers: { Authorization: 'Bearer malformed-token' },
      })
    )

    expect(response.status).toBe(401)
    const body = (await response.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('JWT_INVALID')
  })

  it('accepts valid bearer JWT when JWT validation is configured', async () => {
    const secret = 'jwt-secret'
    mockWorkerEnv.JWT_HS256_SECRET = secret
    mockWorkerEnv.JWT_ISSUER = 'edgecms-tests'
    mockWorkerEnv.JWT_AUDIENCE = 'edgecms-admin'
    const app = await importApp()
    const token = await createHs256Jwt(
      {
        sub: 'service-account',
        iss: 'edgecms-tests',
        aud: 'edgecms-admin',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      secret
    )

    const response = await app.handle(
      new Request('http://localhost/api/health', {
        headers: { Authorization: `Bearer ${token}` },
      })
    )

    expect(response.status).toBe(200)
  })

  it('requires JWT on admin routes when JWT_REQUIRED_FOR_ADMIN is enabled', async () => {
    mockWorkerEnv.JWT_HS256_SECRET = 'jwt-secret'
    mockWorkerEnv.JWT_REQUIRED_FOR_ADMIN = 'true'
    const app = await importApp()

    const response = await app.handle(
      new Request('http://localhost/api/admin/users', {
        method: 'GET',
      })
    )

    expect(response.status).toBe(401)
    const body = (await response.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('JWT_REQUIRED')
  })

  it('serves liveness health probe fast-path via worker.fetch', async () => {
    const worker = await importMain()
    const fetchFn = worker.fetch as (req: Request) => Promise<Response>
    const response = await fetchFn(new Request('http://localhost/api/health/live'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'")
    const body = (await response.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  it('serves liveness health probe HEAD requests via worker.fetch without body', async () => {
    const worker = await importMain()
    const fetchFn = worker.fetch as (req: Request) => Promise<Response>
    const response = await fetchFn(new Request('http://localhost/api/health/live', { method: 'HEAD' }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const text = await response.text()
    expect(text).toBe('')
  })

  it('serves liveness health probe with query params via worker.fetch', async () => {
    const worker = await importMain()
    const fetchFn = worker.fetch as (req: Request) => Promise<Response>
    const response = await fetchFn(new Request('http://localhost/api/health/live?check=1'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  it('does not falsely intercept routes with /api/health/live in sub-paths or search query', async () => {
    const worker = await importMain()
    const fetchFn = worker.fetch as (req: Request) => Promise<Response>

    // Nested path should not hit the liveness fast-path
    const nestedRes = await fetchFn(new Request('http://localhost/api/tenants/t1/collections/api/health/live'))
    expect(nestedRes.status).not.toBe(200)

    // Search query containing /api/health/live? should not hit liveness fast-path
    const searchRes = await fetchFn(new Request('http://localhost/api/bootstrap/status?q=/api/health/live?test'))
    const body = (await searchRes.json()) as Record<string, unknown>
    expect(body.status).not.toBe('ok')
  })

  it('serves liveness health route via app.handle', async () => {
    const app = await importApp()
    const response = await app.handle(new Request('http://localhost/api/health/live'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  it('evicts oldest entries in parsedOriginsCache when reaching capacity (LRU)', async () => {
    const { __resetParsedOriginsCacheForTests } = await importAppModule()
    __resetParsedOriginsCacheForTests()
    const app = await importApp()

    // Query 500 distinct origins for tenant CORS OPTIONS preflight
    for (let i = 0; i < 500; i++) {
      mockFindTenantByIdOrSlug.mockResolvedValueOnce({
        success: true,
        data: { corsOrigin: `https://site-${i}.com` },
      })
      await app.handle(
        new Request(`http://localhost/api/tenants/t-${i}/api/public/collections`, {
          method: 'OPTIONS',
          headers: { origin: `https://site-${i}.com` },
        })
      )
    }

    // Access site-0 again to promote to MRU (already in corsCache)
    const res0 = await app.handle(
      new Request('http://localhost/api/tenants/t-0/api/public/collections', {
        method: 'OPTIONS',
        headers: { origin: 'https://site-0.com' },
      })
    )
    expect(res0.headers.get('access-control-allow-origin')).toBe('https://site-0.com')

    // Add entry 501, which should evict site-1 (oldest unaccessed)
    mockFindTenantByIdOrSlug.mockResolvedValueOnce({
      success: true,
      data: { corsOrigin: 'https://site-500.com' },
    })
    const res500 = await app.handle(
      new Request('http://localhost/api/tenants/t-500/api/public/collections', {
        method: 'OPTIONS',
        headers: { origin: 'https://site-500.com' },
      })
    )
    expect(res500.headers.get('access-control-allow-origin')).toBe('https://site-500.com')
  })
})
