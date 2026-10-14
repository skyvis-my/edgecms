import { describe, expect, it, vi } from 'bun:test'
import { cdnPurgeService } from '@/cache/cdn-purge.service'
import type { Env } from '@/env'

describe('cdnPurgeService', () => {
  describe('purgeCloudflareCacheTags', () => {
    it('skips call when tags array is empty', async () => {
      const mockFetch = vi.fn()
      const result = await cdnPurgeService.purgeCloudflareCacheTags(
        { CF_API_TOKEN: 'token', CLOUDFLARE_ZONE_ID: 'zone-123' },
        [],
        mockFetch as unknown as typeof fetch
      )

      expect(result.success).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('skips gracefully when CF_API_TOKEN or CLOUDFLARE_ZONE_ID is missing', async () => {
      const mockFetch = vi.fn()
      const result = await cdnPurgeService.purgeCloudflareCacheTags(
        {},
        ['collection:posts', 'entry:entry-1'],
        mockFetch as unknown as typeof fetch
      )

      expect(result.success).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('calls Cloudflare API purge_cache endpoint with Bearer auth and tags', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
      const env: Partial<Env> = {
        CF_API_TOKEN: 'cf-secret-token',
        CLOUDFLARE_ZONE_ID: 'zone-abc-456',
      }
      const tags = ['collection:posts', 'entry:entry-1']

      const result = await cdnPurgeService.purgeCloudflareCacheTags(env, tags, mockFetch as unknown as typeof fetch)

      expect(result.success).toBe(true)
      expect(result.tagsPurged).toEqual(tags)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.cloudflare.com/client/v4/zones/zone-abc-456/purge_cache')
      expect(options.method).toBe('POST')
      expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer cf-secret-token')
      expect(JSON.parse(options.body as string)).toEqual({ tags })
    })

    it('handles Cloudflare API HTTP error without throwing', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('Rate limit exceeded', { status: 429 }))
      const env: Partial<Env> = {
        CF_API_TOKEN: 'cf-token',
        CLOUDFLARE_ZONE_ID: 'zone-1',
      }

      const result = await cdnPurgeService.purgeCloudflareCacheTags(env, ['entry:e1'], mockFetch as unknown as typeof fetch)

      expect(result.success).toBe(false)
      expect(result.error).toContain('429')
    })
  })

  describe('dispatchFrontendRevalidation', () => {
    it('skips when revalidateUrl is not provided', async () => {
      const mockFetch = vi.fn()
      const result = await cdnPurgeService.dispatchFrontendRevalidation(
        undefined,
        { event: 'entry.published', tags: ['collection:posts'] },
        undefined,
        mockFetch as unknown as typeof fetch
      )

      expect(result.success).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('dispatches revalidation POST request with tags and paths to frontend', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revalidated: true }), { status: 200 }))
      const payload = {
        event: 'entry.published',
        tags: ['collection:posts', 'entry:entry-1'],
        paths: ['/posts/hello-world', '/posts'],
        entryId: 'entry-1',
        collectionSlug: 'posts',
      }

      const result = await cdnPurgeService.dispatchFrontendRevalidation(
        'https://frontend.example.com/api/revalidate',
        payload,
        'revalidate-secret',
        mockFetch as unknown as typeof fetch
      )

      expect(result.success).toBe(true)
      expect(result.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://frontend.example.com/api/revalidate')
      expect(options.method).toBe('POST')
      expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer revalidate-secret')
      expect((options.headers as Record<string, string>)['x-revalidate-token']).toBe('revalidate-secret')
      expect((options.headers as Record<string, string>)['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
      expect((options.headers as Record<string, string>)['x-hub-signature-256']).toMatch(/^sha256=[a-f0-9]{64}$/)
      expect(JSON.parse(options.body as string)).toEqual(payload)
    })

    it('handles frontend failure response gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('Server Error', { status: 500 }))
      const result = await cdnPurgeService.dispatchFrontendRevalidation(
        'https://frontend.example.com/api/revalidate',
        { event: 'entry.published', tags: ['collection:posts'] },
        undefined,
        mockFetch as unknown as typeof fetch
      )

      expect(result.success).toBe(false)
      expect(result.status).toBe(500)
    })
  })
})
