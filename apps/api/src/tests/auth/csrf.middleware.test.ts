import { describe, expect, it } from 'bun:test'
import {
  buildCsrfCookieHeader,
  createSignedCsrfToken,
  requiresCsrf,
  validateCsrfToken,
} from '../../auth/csrf.middleware'

const SECRET = 'test-secret-at-least-32-characters-long'
const NOW_SECONDS = 1_800_000_000

function makeRequest(
  url: string,
  method: string,
  headers: Record<string, string> = {}
): Request {
  return new Request(url, { method, headers })
}

describe('CSRF Middleware', () => {
  describe('requiresCsrf', () => {
    it('returns false for safe requests', () => {
      expect(requiresCsrf('/api/admin/entries', 'GET')).toBe(false)
      expect(requiresCsrf('/api/admin/entries', 'HEAD')).toBe(false)
      expect(requiresCsrf('/api/admin/entries', 'OPTIONS')).toBe(false)
    })

    it('returns true for admin mutations', () => {
      expect(requiresCsrf('/api/admin/entries', 'POST')).toBe(true)
      expect(requiresCsrf('/api/admin/entries/123', 'PUT')).toBe(true)
      expect(requiresCsrf('/api/admin/entries/123', 'PATCH')).toBe(true)
      expect(requiresCsrf('/api/admin/entries/123', 'DELETE')).toBe(true)
      expect(requiresCsrf('/api/tenants/acme/admin/entries/456', 'DELETE')).toBe(true)
    })

    it('returns false for non-admin mutations', () => {
      expect(requiresCsrf('/api/auth/login', 'POST')).toBe(false)
      expect(requiresCsrf('/api/tenants/acme/public/entries', 'POST')).toBe(false)
      expect(requiresCsrf('/api/health', 'POST')).toBe(false)
    })

    it('matches admin as a path segment only', () => {
      expect(requiresCsrf('/something/admin/other', 'POST')).toBe(true)
      expect(requiresCsrf('/api/administrator', 'POST')).toBe(false)
    })
  })

  describe('validateCsrfToken', () => {
    it('accepts matching signed header and cookie tokens', async () => {
      const token = await createSignedCsrfToken(SECRET, NOW_SECONDS, 'nonce-1')
      const req = makeRequest('http://localhost/api/admin/entries', 'POST', {
        'x-csrf-token': token,
        cookie: `csrf_token=${token}`,
      })

      await expect(validateCsrfToken(req, SECRET, NOW_SECONDS)).resolves.toBe(true)
    })

    it('extracts signed csrf token from multiple cookies', async () => {
      const token = await createSignedCsrfToken(SECRET, NOW_SECONDS, 'nonce-2')
      const req = makeRequest('http://localhost/api/admin/entries', 'POST', {
        'x-csrf-token': token,
        cookie: `session=xyz; csrf_token=${token}; other=value`,
      })

      await expect(validateCsrfToken(req, SECRET, NOW_SECONDS)).resolves.toBe(true)
    })

    it('rejects unsigned matching header and cookie tokens', async () => {
      const req = makeRequest('http://localhost/api/admin/entries', 'POST', {
        'x-csrf-token': 'abc123',
        cookie: 'csrf_token=abc123',
      })

      await expect(validateCsrfToken(req, SECRET, NOW_SECONDS)).resolves.toBe(false)
    })

    it('rejects a signed cookie when header does not match', async () => {
      const token = await createSignedCsrfToken(SECRET, NOW_SECONDS, 'nonce-3')
      const req = makeRequest('http://localhost/api/admin/entries', 'POST', {
        'x-csrf-token': `${token}x`,
        cookie: `csrf_token=${token}`,
      })

      await expect(validateCsrfToken(req, SECRET, NOW_SECONDS)).resolves.toBe(false)
    })

    it('rejects a tampered signed token', async () => {
      const token = await createSignedCsrfToken(SECRET, NOW_SECONDS, 'nonce-4')
      const tampered = token.replace('nonce-4', 'nonce-5')
      const req = makeRequest('http://localhost/api/admin/entries', 'POST', {
        'x-csrf-token': tampered,
        cookie: `csrf_token=${tampered}`,
      })

      await expect(validateCsrfToken(req, SECRET, NOW_SECONDS)).resolves.toBe(false)
    })

    it('rejects expired signed tokens', async () => {
      const token = await createSignedCsrfToken(SECRET, NOW_SECONDS - 86_401, 'nonce-6')
      const req = makeRequest('http://localhost/api/admin/entries', 'POST', {
        'x-csrf-token': token,
        cookie: `csrf_token=${token}`,
      })

      await expect(validateCsrfToken(req, SECRET, NOW_SECONDS)).resolves.toBe(false)
    })

    it('rejects tokens issued too far in the future', async () => {
      const token = await createSignedCsrfToken(SECRET, NOW_SECONDS + 61, 'nonce-7')
      const req = makeRequest('http://localhost/api/admin/entries', 'POST', {
        'x-csrf-token': token,
        cookie: `csrf_token=${token}`,
      })

      await expect(validateCsrfToken(req, SECRET, NOW_SECONDS)).resolves.toBe(false)
    })

    it('rejects missing header or cookie tokens', async () => {
      const token = await createSignedCsrfToken(SECRET, NOW_SECONDS, 'nonce-8')

      await expect(
        validateCsrfToken(
          makeRequest('http://localhost/api/admin/entries', 'POST', {
            cookie: `csrf_token=${token}`,
          }),
          SECRET,
          NOW_SECONDS
        )
      ).resolves.toBe(false)
      await expect(
        validateCsrfToken(
          makeRequest('http://localhost/api/admin/entries', 'POST', {
            'x-csrf-token': token,
          }),
          SECRET,
          NOW_SECONDS
        )
      ).resolves.toBe(false)
    })

    it('builds a scoped SameSite cookie header for signed tokens', async () => {
      const cookie = await buildCsrfCookieHeader(SECRET, { secure: true, nowSeconds: NOW_SECONDS })

      expect(cookie).toContain('csrf_token=v1.')
      expect(cookie).toContain('Path=/')
      expect(cookie).toContain('Max-Age=86400')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Secure')
    })
  })
})
