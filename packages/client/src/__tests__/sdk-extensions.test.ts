import { describe, expect, it, vi } from 'vitest'
import { createEdgeCmsClient } from '../client'
import { computeFallbackChain, resolveBestLocale } from '../locale'
import { verifyWebhookSignature } from '../webhook'

describe('@edgecms/client extensions', () => {
  describe('search()', () => {
    it('executes search query with query parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: 'entry-1', title: 'Edge Performance' }],
          meta: { total: 1, query: 'Performance' },
        }),
      })

      const client = createEdgeCmsClient({
        baseUrl: 'https://cms.example.com',
        tenantSlug: 'acme',
        fetch: mockFetch as any,
      })

      const res = await client.search({ query: 'Performance', limit: 10, locale: 'en' })
      expect(res.data).toHaveLength(1)
      expect(res.data[0].title).toBe('Edge Performance')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://cms.example.com/api/tenants/acme/public/search?q=Performance&limit=10&locale=en',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('throws if query is missing', async () => {
      const client = createEdgeCmsClient({
        baseUrl: 'https://cms.example.com',
        tenantSlug: 'acme',
      })
      await expect(client.search({ query: '' })).rejects.toThrow('Search query is required.')
    })
  })

  describe('uploadAssetDirect()', () => {
    it('executes 3-step direct R2 upload flow', async () => {
      const mockFetch = vi.fn()
        // Step 1: intent
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            uploadUrl: 'https://r2.cloudflarestorage.com/bucket/upload-signed-url',
            key: 'tenants/acme/media/photo.jpg',
            assetId: 'asset_123',
            uploadId: 'up_456',
          }),
        })
        // Step 2: R2 PUT
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        })
        // Step 3: complete
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'asset_123',
            filename: 'photo.jpg',
            size: 1024,
            mimeType: 'image/jpeg',
          }),
        })

      const client = createEdgeCmsClient({
        baseUrl: 'https://cms.example.com',
        tenantSlug: 'acme',
        fetch: mockFetch as any,
      })

      const fakeFile = new Uint8Array([1, 2, 3, 4])
      const asset = await client.uploadAssetDirect({
        file: fakeFile,
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        altText: 'A test photo',
      })

      expect((asset as any).id).toBe('asset_123')
      expect(mockFetch).toHaveBeenCalledTimes(3)
      // Check Step 1 intent
      expect(mockFetch.mock.calls[0][0]).toBe('https://cms.example.com/api/admin/assets/direct-upload-intent')
      // Check Step 2 direct PUT
      expect(mockFetch.mock.calls[1][0]).toBe('https://r2.cloudflarestorage.com/bucket/upload-signed-url')
      expect(mockFetch.mock.calls[1][1].method).toBe('PUT')
      // Check Step 3 confirmation
      expect(mockFetch.mock.calls[2][0]).toBe('https://cms.example.com/api/admin/assets/direct-upload-complete')
    })
  })

  describe('verifyWebhookSignature()', () => {
    it('verifies standard sha256 signature', async () => {
      const secret = 'webhook-super-secret-key'
      const payload = JSON.stringify({ event: 'entry.published', id: '123' })
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
      const sigHex = Array.from(new Uint8Array(sigBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const isValid = await verifyWebhookSignature({
        payload,
        signatureHeader: `sha256=${sigHex}`,
        secret,
      })
      expect(isValid).toBe(true)

      const isInvalid = await verifyWebhookSignature({
        payload,
        signatureHeader: 'sha256=invalidhex12345',
        secret,
      })
      expect(isInvalid).toBe(false)
    })

    it('verifies timestamped signature with tolerance window', async () => {
      const secret = 'webhook-super-secret-key'
      const payload = JSON.stringify({ event: 'entry.published' })
      const now = Math.floor(Date.now() / 1000)
      const signedPayload = `${now}.${payload}`
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload))
      const sigHex = Array.from(new Uint8Array(sigBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const header = `t=${now},v1=${sigHex}`

      const isValid = await verifyWebhookSignature({
        payload,
        signatureHeader: header,
        secret,
        toleranceSeconds: 60,
      })
      expect(isValid).toBe(true)

      // Expired timestamp
      const expiredHeader = `t=${now - 300},v1=${sigHex}`
      const isExpiredValid = await verifyWebhookSignature({
        payload,
        signatureHeader: expiredHeader,
        secret,
        toleranceSeconds: 60,
      })
      expect(isExpiredValid).toBe(false)
    })
  })

  describe('locale fallback utilities', () => {
    it('computes hierarchical fallback chains', () => {
      expect(computeFallbackChain('zh-Hant-HK')).toEqual(['zh-Hant-HK', 'zh-Hant', 'zh'])
      expect(computeFallbackChain('en-US')).toEqual(['en-US', 'en'])
      expect(computeFallbackChain('fr')).toEqual(['fr'])
    })

    it('resolves best available locale', () => {
      const available = ['en', 'fr', 'zh-Hant']
      expect(resolveBestLocale('zh-Hant-HK', available, 'en')).toBe('zh-Hant')
      expect(resolveBestLocale('fr-CA', available, 'en')).toBe('fr')
      expect(resolveBestLocale('de-DE', available, 'en')).toBe('en')
    })
  })
})
