import { describe, expect, it } from 'bun:test'
import {
  ACCESS_TOKEN_DEFAULT_TTL_SECONDS,
  createAccessToken,
  validateRequestJwt,
} from '../../auth/jwt'

function base64UrlEncode(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function signHs256(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = base64UrlEncode({ alg: 'HS256', typ: 'JWT' })
  const body = base64UrlEncode(payload)
  const signingInput = `${header}.${body}`
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
  return `${header}.${body}.${signaturePart}`
}

describe('validateRequestJwt', () => {
  it('returns JWT_REQUIRED when token is required but missing', async () => {
    const request = new Request('http://localhost/api/admin/commands')
    const result = await validateRequestJwt(request, {
      secret: 'secret',
      required: true,
    })

    expect(result).toEqual({
      valid: false,
      code: 'JWT_REQUIRED',
      message: 'Missing bearer token',
    })
  })

  it('rejects token with invalid signature', async () => {
    const valid = await signHs256({ sub: 'svc', exp: Math.floor(Date.now() / 1000) + 60 }, 'good-secret')
    const request = new Request('http://localhost/api/health', {
      headers: {
        Authorization: `Bearer ${valid}`,
      },
    })
    const result = await validateRequestJwt(request, { secret: 'wrong-secret' })

    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('Expected invalid JWT')
    expect(result.code).toBe('JWT_INVALID')
  })

  it('accepts a valid JWT with matching issuer and audience', async () => {
    const token = await signHs256(
      {
        sub: 'service-account',
        iss: 'edgecms',
        aud: 'admin',
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      'shared-secret'
    )
    const request = new Request('http://localhost/api/health', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const result = await validateRequestJwt(request, {
      secret: 'shared-secret',
      issuer: 'edgecms',
      audience: 'admin',
    })

    expect(result.valid).toBe(true)
  })
})

describe('createAccessToken', () => {
  it('mints a token that validates with matching issuer and audience', async () => {
    const token = await createAccessToken(
      { sub: 'u1', tid: 't1', rv: 0, pv: 0 },
      'shared-secret',
      { issuer: 'edgecms', audience: 'admin' }
    )
    const request = new Request('http://localhost/api/health', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const result = await validateRequestJwt(request, {
      secret: 'shared-secret',
      issuer: 'edgecms',
      audience: 'admin',
    })

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('Expected valid JWT')
    expect(result.payload).toMatchObject({ sub: 'u1', tid: 't1', iss: 'edgecms', aud: 'admin' })
  })

  it('uses the default TTL when none is provided', async () => {
    expect(ACCESS_TOKEN_DEFAULT_TTL_SECONDS).toBe(600)
    const before = Math.floor(Date.now() / 1000)
    const token = await createAccessToken({ sub: 'u1' }, 's3cret')
    const request = new Request('http://localhost/x', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const result = await validateRequestJwt(request, { secret: 's3cret' })

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('Expected valid JWT')
    const exp = result.payload?.exp as number
    expect(exp).toBeGreaterThanOrEqual(before + ACCESS_TOKEN_DEFAULT_TTL_SECONDS)
  })

  it('rejects an expired minted token', async () => {
    const token = await createAccessToken({ sub: 'u1' }, 's3cret', { ttlSeconds: -10 })
    const request = new Request('http://localhost/x', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const result = await validateRequestJwt(request, { secret: 's3cret' })

    expect(result.valid).toBe(false)
  })

  it('requires sub and secret', async () => {
    await expect(createAccessToken({ sub: '' }, 's3cret')).rejects.toThrow('sub')
    await expect(createAccessToken({ sub: 'u1' }, '')).rejects.toThrow('secret')
  })
})
