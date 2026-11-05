import { describe, expect, it } from 'bun:test'
import {
  MAX_PREVIEW_TOKEN_TTL_SECONDS,
  generatePreviewToken,
  resolvePreviewSecret,
  verifyPreviewToken,
} from '../../public/preview-token'

const encoder = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data))))
}

/** Signs an arbitrary payload the way the token format does (domain-separated). */
async function signRaw(secret: string, payload: unknown, prefix = 'edgecms.preview.v1.'): Promise<string> {
  const encoded = b64url(encoder.encode(JSON.stringify(payload)))
  return `${encoded}.${await hmac(secret, `${prefix}${encoded}`)}`
}

describe('Preview Token Generator & Verifier', () => {
  const secret = 'super-secret-preview-key-12345'

  it('generates a valid signed ephemeral preview token bound to its issuer', async () => {
    const res = await generatePreviewToken({
      tenantSlug: 'test-tenant',
      issuerId: 'user-1',
      entrySlug: 'my-post',
      collectionSlug: 'posts',
      ttlSeconds: 1800,
      previewUrl: 'http://localhost:3000/preview',
      secret,
    })

    expect(res.token.split('.')).toHaveLength(2)
    expect(res.tenantSlug).toBe('test-tenant')
    expect(res.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))

    const verification = await verifyPreviewToken(res.token, secret, {
      expectedTenantSlug: 'test-tenant',
    })
    expect(verification.valid).toBe(true)
    if (verification.valid) {
      expect(verification.payload.sub).toBe('user-1')
      expect(verification.payload.tenantSlug).toBe('test-tenant')
      expect(verification.payload.entrySlug).toBe('my-post')
      expect(verification.payload.collectionSlug).toBe('posts')
      expect(verification.payload.previewUrl).toBe('http://localhost:3000/preview')
    }
  })

  it('rejects tokens signed with an invalid secret', async () => {
    const res = await generatePreviewToken({ tenantSlug: 'test-tenant', issuerId: 'u', secret })
    const verification = await verifyPreviewToken(res.token, 'wrong-secret')
    expect(verification.valid).toBe(false)
    if (!verification.valid) expect(verification.error).toContain('Invalid token signature')
  })

  it('rejects expired preview tokens', async () => {
    const res = await generatePreviewToken({ tenantSlug: 't', issuerId: 'u', ttlSeconds: 60, secret })
    const verification = await verifyPreviewToken(res.token, secret, { nowSeconds: res.exp + 10 })
    expect(verification.valid).toBe(false)
    if (!verification.valid) expect(verification.error).toContain('expired')
  })

  it('rejects tokens when tenantSlug does not match', async () => {
    const res = await generatePreviewToken({ tenantSlug: 'tenant-a', issuerId: 'u', secret })
    const verification = await verifyPreviewToken(res.token, secret, { expectedTenantSlug: 'tenant-b' })
    expect(verification.valid).toBe(false)
    if (!verification.valid) expect(verification.error).toContain("does not match expected 'tenant-b'")
  })

  it('rejects malformed tokens', async () => {
    expect((await verifyPreviewToken('not.a.valid.jwt.or.token', secret)).valid).toBe(false)
    expect((await verifyPreviewToken('', secret)).valid).toBe(false)
  })

  it('caps the lifetime at one day, whatever TTL is requested', async () => {
    expect(MAX_PREVIEW_TOKEN_TTL_SECONDS).toBe(86400)
    const now = Math.floor(Date.now() / 1000)
    const res = await generatePreviewToken({
      tenantSlug: 't',
      issuerId: 'u',
      ttlSeconds: 7 * 86400,
      secret,
    })
    expect(res.exp).toBeLessThanOrEqual(now + 86400 + 1)
  })

  it('rejects an HMAC of the bare payload (signing input is domain-separated)', async () => {
    // Another component that HMACs caller-chosen data with the same secret
    // (for example a CSRF token on BETTER_AUTH_SECRET) must not mint previews.
    const now = Math.floor(Date.now() / 1000)
    const forged = await signRaw(secret, { tenantSlug: 't', sub: 'u', iat: now, exp: now + 60 }, '')
    expect((await verifyPreviewToken(forged, secret)).valid).toBe(false)
  })

  it('rejects signed payloads without an issuer or a numeric expiry', async () => {
    const now = Math.floor(Date.now() / 1000)
    const noSub = await signRaw(secret, { tenantSlug: 't', iat: now, exp: now + 60 })
    const noExp = await signRaw(secret, { tenantSlug: 't', sub: 'u', iat: now })
    const stringExp = await signRaw(secret, { tenantSlug: 't', sub: 'u', iat: now, exp: '9999999999' })
    for (const token of [noSub, noExp, stringExp]) {
      expect((await verifyPreviewToken(token, secret)).valid).toBe(false)
    }
  })

  it('rejects a signed payload whose lifetime exceeds the cap', async () => {
    const now = Math.floor(Date.now() / 1000)
    const longLived = await signRaw(secret, { tenantSlug: 't', sub: 'u', iat: now, exp: now + 30 * 86400 })
    expect((await verifyPreviewToken(longLived, secret)).valid).toBe(false)
  })
})

describe('resolvePreviewSecret', () => {
  it('prefers PREVIEW_SECRET, then BETTER_AUTH_SECRET', () => {
    expect(resolvePreviewSecret({ PREVIEW_SECRET: 'p', BETTER_AUTH_SECRET: 'b' })).toBe('p')
    expect(resolvePreviewSecret({ BETTER_AUTH_SECRET: 'b' })).toBe('b')
  })

  it('has no built-in default and never reuses the deployment API key', () => {
    expect(resolvePreviewSecret({})).toBeUndefined()
    expect(resolvePreviewSecret(undefined)).toBeUndefined()
    expect(resolvePreviewSecret({ EDGECMS_API_KEY: 'k' } as Parameters<typeof resolvePreviewSecret>[0])).toBeUndefined()
    expect(resolvePreviewSecret({ PREVIEW_SECRET: '', BETTER_AUTH_SECRET: '' })).toBeUndefined()
  })
})
