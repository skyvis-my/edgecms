import { describe, expect, it } from 'bun:test'
import { generatePreviewToken, verifyPreviewToken } from '../../public/preview-token'

describe('Preview Token Generator & Verifier', () => {
  const secret = 'super-secret-preview-key-12345'

  it('generates a valid signed ephemeral preview token', async () => {
    const res = await generatePreviewToken({
      tenantSlug: 'test-tenant',
      entrySlug: 'my-post',
      collectionSlug: 'posts',
      ttlSeconds: 1800,
      previewUrl: 'http://localhost:3000/preview',
      secret,
    })

    expect(res.token).toBeDefined()
    expect(res.token.includes('.')).toBe(true)
    expect(res.tenantSlug).toBe('test-tenant')
    expect(res.entrySlug).toBe('my-post')
    expect(res.collectionSlug).toBe('posts')
    expect(res.previewUrl).toBe('http://localhost:3000/preview')
    expect(res.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(res.expiresAt).toBeDefined()

    // Verify it with verifyPreviewToken
    const verification = await verifyPreviewToken(res.token, secret, {
      expectedTenantSlug: 'test-tenant',
    })
    expect(verification.valid).toBe(true)
    if (verification.valid) {
      expect(verification.payload.tenantSlug).toBe('test-tenant')
      expect(verification.payload.entrySlug).toBe('my-post')
      expect(verification.payload.collectionSlug).toBe('posts')
      expect(verification.payload.previewUrl).toBe('http://localhost:3000/preview')
    }
  })

  it('rejects tokens signed with an invalid secret', async () => {
    const res = await generatePreviewToken({
      tenantSlug: 'test-tenant',
      secret,
    })

    const verification = await verifyPreviewToken(res.token, 'wrong-secret')
    expect(verification.valid).toBe(false)
    if (!verification.valid) {
      expect(verification.error).toContain('Invalid token signature')
    }
  })

  it('rejects expired preview tokens', async () => {
    const res = await generatePreviewToken({
      tenantSlug: 'test-tenant',
      ttlSeconds: 60,
      secret,
    })

    // Simulate future time
    const futureTime = res.exp + 10
    const verification = await verifyPreviewToken(res.token, secret, {
      nowSeconds: futureTime,
    })

    expect(verification.valid).toBe(false)
    if (!verification.valid) {
      expect(verification.error).toContain('expired')
    }
  })

  it('rejects tokens when tenantSlug does not match', async () => {
    const res = await generatePreviewToken({
      tenantSlug: 'tenant-a',
      secret,
    })

    const verification = await verifyPreviewToken(res.token, secret, {
      expectedTenantSlug: 'tenant-b',
    })

    expect(verification.valid).toBe(false)
    if (!verification.valid) {
      expect(verification.error).toContain("does not match expected 'tenant-b'")
    }
  })

  it('rejects malformed tokens', async () => {
    const verification = await verifyPreviewToken('not.a.valid.jwt.or.token', secret)
    expect(verification.valid).toBe(false)

    const verification2 = await verifyPreviewToken('', secret)
    expect(verification2.valid).toBe(false)
  })
})
