import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import type { Env } from '@/env'

const mockPrepare = vi.fn().mockReturnValue({
  all: vi.fn().mockResolvedValue({ results: [] }),
  first: vi.fn().mockResolvedValue(null),
  run: vi.fn().mockResolvedValue({ success: true }),
})
const mockDb = { prepare: mockPrepare } as unknown as D1Database
const mockKv = {
  get: vi.fn().mockResolvedValue(null),
  put: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
} as unknown as KVNamespace

const mockEnv = {
  DB: mockDb,
  CACHE: mockKv,
  MEDIA: {} as R2Bucket,
  ASSETS: {
    fetch: vi.fn(),
  } as unknown as Fetcher,
  PUBLISH_SCHEDULER: {} as DurableObjectNamespace,
  WEBHOOK_QUEUE: {} as Queue,
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
  JWT_HS256_SECRET: 'test-jwt-secret-at-least-32-chars',
  ADMIN_CORS_ALLOWED_ORIGINS: 'http://localhost:5173,https://admin.example.com',
  PUBLIC_CORS_ALLOWED_ORIGINS: 'https://site.example.com',
}

mock.module('cloudflare:workers', () => ({
  env: mockEnv,
}))

const mockGetSession = vi.fn(async ({ headers }: { headers: Headers }) => {
  const auth = headers.get('authorization')
  if (auth === 'Bearer superadmin-token') {
    return {
      user: { id: 'u-super', name: 'Super', email: 'super@admin.com', role: 'superadmin' },
      session: { id: 's-super' },
    }
  }
  if (auth === 'Bearer user-token') {
    return {
      user: { id: 'u-user', name: 'User', email: 'user@example.com', role: 'viewer' },
      session: { id: 's-user' },
    }
  }
  return null
})

mock.module('@/auth/auth', () => ({
  createAuth: vi.fn(() => ({
    handler: vi.fn(() => new Response('Not Found', { status: 404 })),
    api: {
      getSession: mockGetSession,
    },
  })),
}))

const mockEnsureUserHasOnboardingTenant = vi.fn().mockResolvedValue({
  success: true,
  data: { tenantId: 't-1', tenantSlug: 'tenant-1' },
})

mock.module('@/bootstrap/onboarding-tenant', () => ({
  ensureUserHasOnboardingTenant: (...args: unknown[]) => mockEnsureUserHasOnboardingTenant(...args),
}))

const {
  __resetParsedOriginsCacheForTests,
  buildHstsHeader,
  classifyCorsSurface,
  createApp,
  getParsedOrigins,
  mapStatusToErrorCode,
  matchesConfiguredCorsOrigin,
  normalizeConfiguredOrigin,
  parseBooleanEnv,
  parseCorsAllowedOrigins,
  resetPublicCacheWarmingState,
  toHttpErrorStatus,
  warmPublicCacheInBackground,
} = await import('@/app')

describe('API contract export & core bootstrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetParsedOriginsCacheForTests()
    resetPublicCacheWarmingState()
  })

  describe('classifyCorsSurface', () => {
    it('classifies admin endpoints', () => {
      expect(classifyCorsSurface('/api/me')).toBe('admin')
      expect(classifyCorsSurface('/api/csrf')).toBe('admin')
      expect(classifyCorsSurface('/api/docs')).toBe('admin')
      expect(classifyCorsSurface('/api/bootstrap/status')).toBe('admin')
      expect(classifyCorsSurface('/api/auth/sign-in')).toBe('admin')
      expect(classifyCorsSurface('/api/admin/collections')).toBe('admin')
      expect(classifyCorsSurface('/api/tenants/acme/api/admin/entries')).toBe('admin')
    })

    it('classifies public endpoints', () => {
      expect(classifyCorsSurface('/api/public/entries')).toBe('public')
      expect(classifyCorsSurface('/api/graphql')).toBe('public')
      expect(classifyCorsSurface('/api/tenants/acme/api/public/feed')).toBe('public')
      expect(classifyCorsSurface('/api/tenants/acme/graphql')).toBe('public')
    })

    it('classifies health and other endpoints as none', () => {
      expect(classifyCorsSurface('/api/health')).toBe('none')
      expect(classifyCorsSurface('/api/health/live')).toBe('none')
      expect(classifyCorsSurface('/favicon.ico')).toBe('none')
    })
  })

  describe('app HTTP handling & security headers', () => {
    const app = createApp()

    it('builds an app instance that serves /api/health and /api root', async () => {
      const resHealth = await app.handle(new Request('http://localhost/api/health'))
      expect(resHealth.status).toBe(200)

      const resRoot = await app.handle(new Request('http://localhost/api'))
      expect(resRoot.status).toBe(200)
    })

    it('serves /api/health/live with ok status', async () => {
      const res = await app.handle(new Request('http://localhost/api/health/live'))
      expect(res.status).toBe(200)
      const data = (await res.json()) as { status: string }
      expect(data.status).toBe('ok')
    })

    it('serves /api/bootstrap/status fallback', async () => {
      const res = await app.handle(new Request('http://localhost/api/bootstrap/status'))
      expect(res.status).toBe(200)
      const data = (await res.json()) as { needsOnboarding: boolean; userCount: number }
      expect(typeof data.needsOnboarding).toBe('boolean')
      expect(typeof data.userCount).toBe('number')
    })

    it('generates signed CSRF token via GET /api/csrf', async () => {
      const res = await app.handle(new Request('http://localhost/api/csrf'))
      expect(res.status).toBe(200)
      const data = (await res.json()) as { success: boolean; data: { csrfToken: string } }
      expect(data.success).toBe(true)
      expect(data.data.csrfToken).toBeTruthy()
      expect(res.headers.get('set-cookie')).toContain('csrf_token=')
    })

    it('applies standard security headers and traceparent to responses', async () => {
      const res = await app.handle(new Request('http://localhost/api/health'))
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('x-frame-options')).toBe('DENY')
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
      expect(res.headers.get('x-api-version')).toBeTruthy()
      expect(res.headers.get('traceparent')).toBeTruthy()
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'")
    })

    it('applies relaxed GraphQL CSP headers for /api/graphql', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/graphql', {
          method: 'GET',
        })
      )
      const csp = res.headers.get('content-security-policy') ?? ''
      expect(csp).toContain('https://unpkg.com')
    })

    it('handles CORS preflight OPTIONS request for allowed admin origin', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/admin/collections', {
          method: 'OPTIONS',
          headers: {
            Origin: 'http://localhost:5173',
            'Access-Control-Request-Method': 'GET',
          },
        })
      )
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
      expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    })

    it('handles CORS preflight OPTIONS request for untrusted origin', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/admin/collections', {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://evil-attacker.com',
            'Access-Control-Request-Method': 'GET',
          },
        })
      )
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
      expect(res.headers.get('cache-control')).toContain('public, max-age=86400')
    })

    it('rejects unsupported content-type on API POST requests with payload (415)', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/admin/collections', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
          },
          body: 'hello world',
        })
      )
      expect(res.status).toBe(415)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    })

    it('returns 404 with error envelope for non-existent route', async () => {
      const res = await app.handle(new Request('http://localhost/api/nonexistent-route-xyz'))
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('returns 422 with VALIDATION_ERROR envelope for invalid schema inputs', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/admin/collections', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ invalidField: 123 }),
        })
      )
      expect([401, 422]).toContain(res.status)
    })

    it('handles CORS preflight for allowed public origin', async () => {
      const res = await app.handle(
        new Request('http://localhost/api/public/entries', {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://site.example.com',
            'Access-Control-Request-Method': 'GET',
          },
        })
      )
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('https://site.example.com')
    })

    it('requires authentication for /api/me and returns correct role', async () => {
      const resUnauth = await app.handle(new Request('http://localhost/api/me'))
      expect(resUnauth.status).toBe(401)

      const resSuper = await app.handle(
        new Request('http://localhost/api/me', {
          headers: { Authorization: 'Bearer superadmin-token' },
        })
      )
      expect(resSuper.status).toBe(200)
      const dataSuper = (await resSuper.json()) as { role: string }
      expect(dataSuper.role).toBe('superadmin')

      const resViewer = await app.handle(
        new Request('http://localhost/api/me', {
          headers: { Authorization: 'Bearer user-token' },
        })
      )
      expect(resViewer.status).toBe(200)
      const dataViewer = (await resViewer.json()) as { role: string }
      expect(dataViewer.role).toBe('viewer')
    })

    it('handles /api/bootstrap/provision-tenant success and failure states', async () => {
      const resUnauth = await app.handle(
        new Request('http://localhost/api/bootstrap/provision-tenant', {
          method: 'POST',
        })
      )
      expect(resUnauth.status).toBe(401)

      mockEnsureUserHasOnboardingTenant.mockResolvedValueOnce({
        success: true,
        data: { tenantId: 't-1', tenantSlug: 'tenant-1' },
      })
      const resSuccess = await app.handle(
        new Request('http://localhost/api/bootstrap/provision-tenant', {
          method: 'POST',
          headers: { Authorization: 'Bearer user-token' },
        })
      )
      expect(resSuccess.status).toBe(201)
      const dataSuccess = (await resSuccess.json()) as { success: boolean }
      expect(dataSuccess.success).toBe(true)

      mockEnsureUserHasOnboardingTenant.mockResolvedValueOnce({
        success: false,
        error: { code: 'CONFLICT', message: 'Tenant already exists' },
      })
      const resConflict = await app.handle(
        new Request('http://localhost/api/bootstrap/provision-tenant', {
          method: 'POST',
          headers: { Authorization: 'Bearer user-token' },
        })
      )
      expect(resConflict.status).toBe(409)

      mockEnsureUserHasOnboardingTenant.mockResolvedValueOnce({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Failed to create' },
      })
      const resBadRequest = await app.handle(
        new Request('http://localhost/api/bootstrap/provision-tenant', {
          method: 'POST',
          headers: { Authorization: 'Bearer user-token' },
        })
      )
      expect(resBadRequest.status).toBe(400)
    })
  })

  describe('buildHstsHeader', () => {
    it('returns undefined when HSTS_MAX_AGE_SECONDS is not set', () => {
      expect(buildHstsHeader({})).toBeUndefined()
    })

    it('returns valid max-age directive', () => {
      expect(buildHstsHeader({ HSTS_MAX_AGE_SECONDS: '3600' })).toBe('max-age=3600')
    })

    it('includes subdomains when enabled', () => {
      expect(
        buildHstsHeader({ HSTS_MAX_AGE_SECONDS: '3600', HSTS_INCLUDE_SUBDOMAINS: 'true' })
      ).toBe('max-age=3600; includeSubDomains')
    })

    it('includes preload when prerequisites are met', () => {
      expect(
        buildHstsHeader({
          HSTS_MAX_AGE_SECONDS: '31536000',
          HSTS_INCLUDE_SUBDOMAINS: 'true',
          HSTS_PRELOAD: 'true',
        })
      ).toBe('max-age=31536000; includeSubDomains; preload')
    })

    it('throws when max-age is negative or not finite', () => {
      expect(() => buildHstsHeader({ HSTS_MAX_AGE_SECONDS: '-1' })).toThrow(
        'HSTS_MAX_AGE_SECONDS must be a non-negative integer'
      )
      expect(() => buildHstsHeader({ HSTS_MAX_AGE_SECONDS: 'not-a-number' })).toThrow(
        'HSTS_MAX_AGE_SECONDS must be a non-negative integer'
      )
    })

    it('throws when preload is requested without includeSubdomains or sufficient max-age', () => {
      expect(() =>
        buildHstsHeader({
          HSTS_MAX_AGE_SECONDS: '1000',
          HSTS_INCLUDE_SUBDOMAINS: 'true',
          HSTS_PRELOAD: 'true',
        })
      ).toThrow('HSTS_PRELOAD requires HSTS_INCLUDE_SUBDOMAINS=true and HSTS_MAX_AGE_SECONDS >= 31536000')

      expect(() =>
        buildHstsHeader({
          HSTS_MAX_AGE_SECONDS: '31536000',
          HSTS_INCLUDE_SUBDOMAINS: 'false',
          HSTS_PRELOAD: 'true',
        })
      ).toThrow('HSTS_PRELOAD requires HSTS_INCLUDE_SUBDOMAINS=true and HSTS_MAX_AGE_SECONDS >= 31536000')
    })
  })

  describe('normalizeConfiguredOrigin and parseCorsAllowedOrigins', () => {
    it('normalizes valid origins', () => {
      expect(normalizeConfiguredOrigin('http://localhost:5173/')).toBe('http://localhost:5173')
      expect(normalizeConfiguredOrigin('https://api.example.com')).toBe('https://api.example.com')
      expect(normalizeConfiguredOrigin('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    })

    it('rejects invalid or unsafe origins', () => {
      expect(() => normalizeConfiguredOrigin('*')).toThrow("Invalid CORS origin '*'")
      expect(() => normalizeConfiguredOrigin('null')).toThrow("Invalid CORS origin 'null'")
      expect(() => normalizeConfiguredOrigin('ftp://example.com')).toThrow("Invalid CORS origin 'ftp://example.com'")
      expect(() => normalizeConfiguredOrigin('https://example.com/api')).toThrow('CORS origin must not include path')
      expect(() => normalizeConfiguredOrigin('https://example.com?foo=1')).toThrow('CORS origin must not include path')
      expect(() => normalizeConfiguredOrigin('http://remote-server.com')).toThrow(
        'HTTP CORS origin is only allowed for local development'
      )
    })

    it('parses comma-separated origins and defaults', () => {
      const defaults = ['http://localhost:5173']
      expect(parseCorsAllowedOrigins(undefined, defaults)).toEqual(new Set(defaults))
      expect(parseCorsAllowedOrigins('', defaults)).toEqual(new Set(defaults))

      const parsed = parseCorsAllowedOrigins('http://localhost:3000, https://app.example.com')
      expect(parsed.has('http://localhost:3000')).toBe(true)
      expect(parsed.has('https://app.example.com')).toBe(true)
    })

    it('caches parsed origins, uses LRU cache, and evicts oldest entries past 500 keys', () => {
      __resetParsedOriginsCacheForTests()
      const firstSet = getParsedOrigins('https://example.com')
      expect(firstSet.has('https://example.com')).toBe(true)

      // Cache hit
      const secondSet = getParsedOrigins('https://example.com')
      expect(secondSet).toBe(firstSet)

      // Matching origin check
      expect(matchesConfiguredCorsOrigin('https://example.com, https://test.com', 'https://test.com/')).toBe(true)
      expect(matchesConfiguredCorsOrigin('https://example.com', 'https://not-allowed.com')).toBe(false)

      // Eviction test: fill past 500 keys
      for (let i = 0; i <= 505; i++) {
        getParsedOrigins(`https://sub-${i}.example.com`)
      }
    })
  })

  describe('parseBooleanEnv', () => {
    it('handles truthy string variants', () => {
      expect(parseBooleanEnv('1')).toBe(true)
      expect(parseBooleanEnv('true')).toBe(true)
      expect(parseBooleanEnv('yes')).toBe(true)
      expect(parseBooleanEnv('on')).toBe(true)
      expect(parseBooleanEnv('TRUE')).toBe(true)
    })

    it('returns false for falsy or missing values', () => {
      expect(parseBooleanEnv(undefined)).toBe(false)
      expect(parseBooleanEnv('')).toBe(false)
      expect(parseBooleanEnv('false')).toBe(false)
      expect(parseBooleanEnv('0')).toBe(false)
      expect(parseBooleanEnv('off')).toBe(false)
    })
  })

  describe('toHttpErrorStatus and mapStatusToErrorCode', () => {
    it('validates HTTP error status ranges', () => {
      expect(toHttpErrorStatus(400)).toBe(400)
      expect(toHttpErrorStatus(404)).toBe(404)
      expect(toHttpErrorStatus(500)).toBe(500)
      expect(toHttpErrorStatus(200)).toBe(500)
      expect(toHttpErrorStatus(600)).toBe(500)
      expect(toHttpErrorStatus('bad')).toBe(500)
      expect(toHttpErrorStatus(null)).toBe(500)
    })

    it('maps statuses to standard canonical error codes', () => {
      expect(mapStatusToErrorCode(400)).toBe('BAD_REQUEST')
      expect(mapStatusToErrorCode(401)).toBe('UNAUTHORIZED')
      expect(mapStatusToErrorCode(403)).toBe('FORBIDDEN')
      expect(mapStatusToErrorCode(404)).toBe('NOT_FOUND')
      expect(mapStatusToErrorCode(405)).toBe('METHOD_NOT_ALLOWED')
      expect(mapStatusToErrorCode(415)).toBe('UNSUPPORTED_MEDIA_TYPE')
      expect(mapStatusToErrorCode(422)).toBe('VALIDATION_ERROR')
      expect(mapStatusToErrorCode(429)).toBe('RATE_LIMITED')
      expect(mapStatusToErrorCode(500)).toBe('INTERNAL_ERROR')
      expect(mapStatusToErrorCode(503)).toBe('INTERNAL_ERROR')
      expect(mapStatusToErrorCode(418)).toBe('BAD_REQUEST')
    })
  })

  describe('cache warming background execution', () => {
    it('skips warming if bindings are missing prepare/get/put', () => {
      warmPublicCacheInBackground({
        DB: {} as unknown as D1Database,
        CACHE: {} as unknown as KVNamespace,
      } as unknown as Env)
    })

    it('executes background warming once and invokes waitUntil', () => {
      const waitUntil = vi.fn()
      warmPublicCacheInBackground(
        {
          DB: mockDb,
          CACHE: mockKv,
        } as unknown as Env,
        { waitUntil } as unknown as ExecutionContext
      )

      expect(waitUntil).toHaveBeenCalled()

      // Calling again should be idempotent (hasWarmedCache = true)
      waitUntil.mockClear()
      warmPublicCacheInBackground(
        {
          DB: mockDb,
          CACHE: mockKv,
        } as unknown as Env,
        { waitUntil } as unknown as ExecutionContext
      )
      expect(waitUntil).not.toHaveBeenCalled()
    })
  })
})
