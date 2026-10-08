import { describe, expect, it } from 'bun:test'
import { createSignedCsrfToken, requiresCsrf, validateCsrfToken } from '../../auth/csrf.middleware'
import { canMutate, isAdminMutationPath } from '../../auth/rbac'

const CSRF_SECRET = 'test-secret-at-least-32-characters-long'

describe('auth middleware foundations', () => {
  it('blocks non-safe admin mutations unless actor can mutate', () => {
    expect(isAdminMutationPath('/api/admin/entries', 'POST')).toBe(true)
    expect(canMutate('viewer')).toBe(false)
    expect(canMutate('editor')).toBe(true)
  })

  it('requires signed csrf token on admin write paths', async () => {
    const token = await createSignedCsrfToken(CSRF_SECRET, 1_800_000_000, 'nonce-1')
    const req = new Request('http://localhost/api/admin/entries', {
      method: 'POST',
      headers: {
        'x-csrf-token': token,
        cookie: `csrf_token=${token}`,
      },
    })

    expect(requiresCsrf('/api/admin/entries', 'POST')).toBe(true)
    await expect(validateCsrfToken(req, CSRF_SECRET, 1_800_000_000)).resolves.toBe(true)
  })

  it('rejects csrf token when it does not match csrf cookie', async () => {
    const token = await createSignedCsrfToken(CSRF_SECRET, 1_800_000_000, 'nonce-2')
    const req = new Request('http://localhost/api/admin/entries', {
      method: 'POST',
      headers: {
        'x-csrf-token': `${token}x`,
        cookie: `csrf_token=${token}`,
      },
    })

    await expect(validateCsrfToken(req, CSRF_SECRET, 1_800_000_000)).resolves.toBe(false)
  })
})
