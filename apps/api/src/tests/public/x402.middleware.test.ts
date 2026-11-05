import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'

import {
  createL402Challenge,
  createSettlementToken,
  verifyL402Token,
  isMonetizedRequest,
  handleX402Gate,
  resolveX402Secret,
  isSettledPaidRead,
} from '@/public/x402.middleware'

const TEST_SECRET = 'super_secret_test_key_for_x402_signatures'

function settle(challengeId: string, resource: string, extra: Partial<{ tenantId: string; price: number; currency: string; ttlSeconds: number }> = {}) {
  return createSettlementToken(TEST_SECRET, {
    challengeId,
    resource,
    price: 100,
    currency: 'SATS',
    ...extra,
  })
}
const expect100 = (resource: string, tenantId?: string) => ({ resource, tenantId, price: 100, currency: 'SATS' })

describe('HTTP 402 / x402 Agent Micropayments Protocol Adapter (C-16)', () => {
  describe('createL402Challenge & verifyL402Token', () => {
    it('creates a compliant L402 challenge with macaroon, price, invoice, and expiry', async () => {
      const challenge = await createL402Challenge(TEST_SECRET, '/api/public/premium-news', {
        price: 250,
        currency: 'SATS',
        ttlSeconds: 600,
      })

      expect(challenge.challengeId).toBeDefined()
      expect(challenge.price).toBe(250)
      expect(challenge.currency).toBe('SATS')
      expect(challenge.invoice).toContain('lnbc250n1')
      expect(challenge.macaroon).toContain('.')
      expect(challenge.expiresAt).toBeGreaterThan(Date.now())
    })

    it('verifies valid HMAC settlement token and confirms settlement', async () => {
      const challenge = await createL402Challenge(TEST_SECRET, '/api/public/data', { price: 50 })
      const token = await settle(challenge.challengeId, '/api/public/data', { price: 50 })

      const verification = await verifyL402Token(TEST_SECRET, token, { resource: '/api/public/data', price: 50, currency: 'SATS' })
      expect(verification.valid).toBe(true)
      expect(verification.settled).toBe(true)
      expect(verification.challengeId).toBe(challenge.challengeId)
    })

    it('handles Authorization header format with L402 prefix', async () => {
      const token = await settle('chal-123', '/api/public/report')
      const authHeader = `L402 ${token}`

      const verification = await verifyL402Token(TEST_SECRET, authHeader, expect100('/api/public/report'))
      expect(verification.valid).toBe(true)
      expect(verification.settled).toBe(true)
      expect(verification.challengeId).toBe('chal-123')
    })

    it('rejects tampered token with invalid signature', async () => {
      const token = await settle('chal-123', '/api/public/data')
      const tampered = token.slice(0, -5) + 'AAAAA'

      const verification = await verifyL402Token(TEST_SECRET, tampered, expect100('/api/public/data'))
      expect(verification.valid).toBe(false)
      expect(verification.settled).toBe(false)
      expect(verification.reason).toBe('invalid_signature')
    })

    it('rejects malformed token', async () => {
      const verification = await verifyL402Token(TEST_SECRET, 'invalid-non-dotted-token', expect100('/api/public/data'))
      expect(verification.valid).toBe(false)
      expect(verification.reason).toBe('malformed_token')
    })

    it('rejects token when presented against a different resource (resource mismatch)', async () => {
      const token = await settle('chal-123', '/api/public/data')
      const verification = await verifyL402Token(TEST_SECRET, token, expect100('/api/public/expensive-secret'))
      expect(verification.valid).toBe(false)
      expect(verification.settled).toBe(false)
      expect(verification.reason).toBe('resource_mismatch')
    })

    it('does not accept a bare KV key as a settlement (no unbound shortcut)', async () => {
      const verification = await verifyL402Token(TEST_SECRET, 'preimage-xyz', expect100('/api/public/data'))
      expect(verification.valid).toBe(false)
    })

    it('rejects the challenge macaroon used as a settlement proof', async () => {
      const challenge = await createL402Challenge(TEST_SECRET, '/api/public/premium')
      const verification = await verifyL402Token(TEST_SECRET, challenge.macaroon, expect100('/api/public/premium'))
      expect(verification.valid).toBe(false)
      expect(verification.reason).toBe('not_a_settlement')
    })

    it('rejects an expired settlement token', async () => {
      const token = await settle('chal-old', '/api/public/premium', { ttlSeconds: 1 })
      const realNow = Date.now
      Date.now = () => realNow() + 2000
      try {
        const verification = await verifyL402Token(TEST_SECRET, token, expect100('/api/public/premium'))
        expect(verification.reason).toBe('token_expired')
      } finally {
        Date.now = realNow
      }
    })

    it('caps settlement lifetime at one day', async () => {
      const token = await settle('chal-long', '/api/public/premium', { ttlSeconds: 10 * 86400 })
      const realNow = Date.now
      Date.now = () => realNow() + 86400 * 1000 + 1000
      try {
        const verification = await verifyL402Token(TEST_SECRET, token, expect100('/api/public/premium'))
        expect(verification.reason).toBe('token_expired')
      } finally {
        Date.now = realNow
      }
    })

    it('rejects a token minted for another tenant on the same path', async () => {
      const token = await settle('chal-a', '/api/public/premium', { tenantId: 'tenant-a' })
      const verification = await verifyL402Token(TEST_SECRET, token, expect100('/api/public/premium', 'tenant-b'))
      expect(verification.reason).toBe('tenant_mismatch')
      const global = await verifyL402Token(TEST_SECRET, token, expect100('/api/public/premium'))
      expect(global.reason).toBe('tenant_mismatch')
    })

    it('rejects a token settled for a lower price or another currency', async () => {
      const cheap = await settle('chal-cheap', '/api/public/premium', { price: 1 })
      expect((await verifyL402Token(TEST_SECRET, cheap, expect100('/api/public/premium'))).reason).toBe(
        'amount_mismatch'
      )
      const usd = await settle('chal-usd', '/api/public/premium', { currency: 'USD' })
      expect((await verifyL402Token(TEST_SECRET, usd, expect100('/api/public/premium'))).reason).toBe(
        'amount_mismatch'
      )
    })

    it('rejects a token signed with a different secret (e.g. the old built-in default)', async () => {
      const forged = await createSettlementToken('edgecms_secret', {
        challengeId: 'x',
        resource: '/api/public/premium',
        price: 100,
        currency: 'SATS',
      })
      const verification = await verifyL402Token(TEST_SECRET, forged, expect100('/api/public/premium'))
      expect(verification.reason).toBe('invalid_signature')
    })
  })

  describe('resolveX402Secret', () => {
    it('uses X402_SECRET only, never auth or API-key secrets', () => {
      expect(resolveX402Secret({ X402_SECRET: 'abc' })).toBe('abc')
      expect(resolveX402Secret({ BETTER_AUTH_SECRET: 'auth', EDGECMS_API_KEY: 'key' } as never)).toBeUndefined()
      expect(resolveX402Secret({ X402_SECRET: '  ' })).toBeUndefined()
      expect(resolveX402Secret(undefined)).toBeUndefined()
    })
  })

  describe('isMonetizedRequest', () => {
    it('detects x-402-require header', () => {
      const req = new Request('http://localhost/api/public/posts', {
        headers: { 'x-402-require': 'true' },
      })
      expect(isMonetizedRequest(req, 'posts')).toBe(true)
    })

    it('detects paywall=true query parameter', () => {
      const req = new Request('http://localhost/api/public/posts?paywall=true')
      expect(isMonetizedRequest(req, 'posts')).toBe(true)
    })

    it('detects monetized collection slugs (premium-*, paywall-*, paid-*)', () => {
      const req = new Request('http://localhost/api/public/premium-articles')
      expect(isMonetizedRequest(req, 'premium-articles')).toBe(true)
      expect(isMonetizedRequest(req, 'paywall-content')).toBe(true)
      expect(isMonetizedRequest(req, 'paid-reports')).toBe(true)
    })

    it('returns false for standard free public routes', () => {
      const req = new Request('http://localhost/api/public/blog')
      expect(isMonetizedRequest(req, 'blog')).toBe(false)
    })
  })

  describe('handleX402Gate', () => {
    it('allows non-monetized requests to pass without intervention', async () => {
      const ctx = {
        request: new Request('http://localhost/api/public/free-posts'),
        set: { headers: {} },
      } as any

      const res = await handleX402Gate(ctx, { secret: TEST_SECRET, collectionSlug: 'free-posts' })
      expect(res).toBeNull()
      expect(ctx.set.headers['X-402-Settled']).toBeUndefined()
    })

    it('intercepts unauthenticated monetized request with HTTP 402 and L402 challenge', async () => {
      const ctx = {
        request: new Request('http://localhost/api/public/premium-posts'),
        set: { headers: {} },
      } as any

      const response = await handleX402Gate(ctx, {
        secret: TEST_SECRET,
        collectionSlug: 'premium-posts',
        price: 150,
      })

      expect(response).not.toBeNull()
      expect(response?.status).toBe(402)
      expect(response?.headers.get('WWW-Authenticate')).toContain('L402')
      expect(response?.headers.get('X-402-Price')).toBe('150')
      expect(response?.headers.get('X-402-Currency')).toBe('SATS')
      expect(response?.headers.get('X-402-Challenge')).toBeDefined()

      const body = (await response?.json()) as any
      expect(body.code).toBe('PAYMENT_REQUIRED')
      expect(body.price).toBe(150)
      expect(body.challenge).toBeDefined()
    })

    it('permits request and adds X-402-Settled header when valid token is provided', async () => {
      const token = await settle('chal-paid-1', '/api/public/premium-posts')
      const ctx = {
        request: new Request('http://localhost/api/public/premium-posts', {
          headers: {
            Authorization: `L402 ${token}`,
          },
        }),
        set: { headers: {} },
      } as any

      const response = await handleX402Gate(ctx, {
        secret: TEST_SECRET,
        collectionSlug: 'premium-posts',
      })

      expect(response).toBeNull() // Proceed to route handler
      expect(ctx.set.headers['X-402-Settled']).toBe('true')
      expect(ctx.set.headers['X-402-Receipt']).toBe('chal-paid-1')
      expect(isSettledPaidRead(ctx.set.headers)).toBe(true)
    })

    it('binds the challenge to the request tenant', async () => {
      const ctx = {
        request: new Request('http://localhost/api/public/premium-posts'),
        set: { headers: {} },
      } as any
      const response = await handleX402Gate(ctx, {
        secret: TEST_SECRET,
        collectionSlug: 'premium-posts',
        tenantId: 'tenant-a',
      })
      const { macaroon } = (await response!.json()) as { macaroon: string }
      const payload = JSON.parse(atob(macaroon.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/')))
      expect(payload.tid).toBe('tenant-a')
      expect(payload.typ).toBe('x402.challenge')
    })
  })

  describe('Elysia Integration with handleX402Gate', () => {
    const testApp = new Elysia({ prefix: '/api/public' }).get(
      '/:collectionSlug',
      async (ctx) => {
        const x402Res = await handleX402Gate(ctx as any, {
          secret: TEST_SECRET,
          collectionSlug: ctx.params.collectionSlug,
          price: 100,
        })
        if (x402Res) return x402Res
        return { success: true, collection: ctx.params.collectionSlug }
      }
    )

    it('returns HTTP 402 when requesting a premium collection without payment', async () => {
      const req = new Request('http://localhost/api/public/premium-articles')
      const res = await testApp.handle(req)

      expect(res.status).toBe(402)
      expect(res.headers.get('WWW-Authenticate')).toContain('L402')
      expect(res.headers.get('X-402-Price')).toBe('100')
      const data = (await res.json()) as any
      expect(data.code).toBe('PAYMENT_REQUIRED')
      expect(data.challenge).toBeDefined()
    })

    it('returns 200 OK with X-402-Settled header when valid payment token is supplied', async () => {
      const token = await settle('chal-settled-100', '/api/public/premium-articles')
      const req = new Request('http://localhost/api/public/premium-articles', {
        headers: {
          Authorization: `L402 ${token}`,
        },
      })
      const res = await testApp.handle(req)

      expect(res.status).toBe(200)
      expect(res.headers.get('X-402-Settled')).toBe('true')
      const data = (await res.json()) as any
      expect(data.success).toBe(true)
      expect(data.collection).toBe('premium-articles')
    })
  })

  describe('fail-closed when secret missing', () => {
    it('createL402Challenge throws 500 without secret', async () => {
      await expect(createL402Challenge('', '/api/public/premium')).rejects.toMatchObject({
        status: 500,
      })
    })

    it('createSettlementToken throws 500 without secret', async () => {
      await expect(
        createSettlementToken('', { challengeId: 'chal-1', resource: '/res', price: 1, currency: 'SATS' })
      ).rejects.toMatchObject({
        status: 500,
      })
    })

    it('verifyL402Token throws 500 without secret', async () => {
      await expect(verifyL402Token('', 'tok', expect100('/res'))).rejects.toMatchObject({ status: 500 })
    })

    it('handleX402Gate answers 500 CONFIG_ERROR (no-store) for a monetized request without secret', async () => {
      for (const secret of ['', undefined]) {
        const ctx = {
          request: new Request('http://localhost/api/public/premium-posts'),
          set: { headers: {} },
        } as any
        const res = await handleX402Gate(ctx, { secret, collectionSlug: 'premium-posts' })
        expect(res?.status).toBe(500)
        expect(res?.headers.get('cache-control')).toBe('private, no-store')
        const body = (await res!.json()) as { error: { code: string } }
        expect(body.error.code).toBe('CONFIG_ERROR')
        expect(ctx.set.headers['X-402-Settled']).toBeUndefined()
      }
    })

    it('free routes still pass without secret', async () => {
      const ctx = {
        request: new Request('http://localhost/api/public/free-posts'),
        set: { headers: {} },
      } as any
      const res = await handleX402Gate(ctx, { secret: '', collectionSlug: 'free-posts' })
      expect(res).toBeNull()
    })
  })
})
