import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'

import {
  createL402Challenge,
  createSettlementToken,
  verifyL402Token,
  isMonetizedRequest,
  handleX402Gate,
} from '@/public/x402.middleware'

const TEST_SECRET = 'super_secret_test_key_for_x402_signatures'

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
      const token = await createSettlementToken(TEST_SECRET, challenge.challengeId, '/api/public/data')

      const verification = await verifyL402Token(TEST_SECRET, token, '/api/public/data')
      expect(verification.valid).toBe(true)
      expect(verification.settled).toBe(true)
      expect(verification.challengeId).toBe(challenge.challengeId)
    })

    it('handles Authorization header format with L402 prefix', async () => {
      const token = await createSettlementToken(TEST_SECRET, 'chal-123', '/api/public/report')
      const authHeader = `L402 ${token}`

      const verification = await verifyL402Token(TEST_SECRET, authHeader, '/api/public/report')
      expect(verification.valid).toBe(true)
      expect(verification.settled).toBe(true)
      expect(verification.challengeId).toBe('chal-123')
    })

    it('rejects tampered token with invalid signature', async () => {
      const token = await createSettlementToken(TEST_SECRET, 'chal-123', '/api/public/data')
      const tampered = token.slice(0, -5) + 'AAAAA'

      const verification = await verifyL402Token(TEST_SECRET, tampered, '/api/public/data')
      expect(verification.valid).toBe(false)
      expect(verification.settled).toBe(false)
      expect(verification.reason).toBe('invalid_signature')
    })

    it('rejects malformed token', async () => {
      const verification = await verifyL402Token(TEST_SECRET, 'invalid-non-dotted-token', '/api/public/data')
      expect(verification.valid).toBe(false)
      expect(verification.reason).toBe('malformed_token')
    })

    it('rejects token when presented against a different resource (resource mismatch)', async () => {
      const token = await createSettlementToken(TEST_SECRET, 'chal-123', '/api/public/data')
      const verification = await verifyL402Token(TEST_SECRET, token, '/api/public/expensive-secret')
      expect(verification.valid).toBe(false)
      expect(verification.settled).toBe(false)
      expect(verification.reason).toBe('resource_mismatch')
    })

    it('resolves settlement token from KV cache', async () => {
      const mockKv = {
        get: async (key: string) => {
          if (key === 'x402:settled:preimage-xyz') return 'chal-kv-settled'
          return null
        },
      } as unknown as KVNamespace

      const verification = await verifyL402Token(TEST_SECRET, 'preimage-xyz', '/api/public/data', mockKv)
      expect(verification.valid).toBe(true)
      expect(verification.settled).toBe(true)
      expect(verification.challengeId).toBe('chal-kv-settled')
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
      const token = await createSettlementToken(TEST_SECRET, 'chal-paid-1', '/api/public/premium-posts')
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
      const token = await createSettlementToken(TEST_SECRET, 'chal-settled-100', '/api/public/premium-articles')
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
})
