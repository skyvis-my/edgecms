import { describe, expect, it, vi } from 'bun:test'
import { createEdgeCmsClient } from '../client'

describe('@edgecms/client HTTP Query Builder', () => {
  it('initializes with required baseUrl and tenantSlug', () => {
    const client = createEdgeCmsClient({
      baseUrl: 'https://cms.example.com/',
      tenantSlug: 'acme',
    })

    expect(client.baseUrl).toBe('https://cms.example.com')
    expect(client.tenantSlug).toBe('acme')
    expect(client.defaultLocale).toBe('en')
  })

  it('fails if baseUrl or tenantSlug is missing', () => {
    // @ts-expect-error test invalid args
    expect(() => createEdgeCmsClient({})).toThrow()
    // @ts-expect-error test invalid args
    expect(() => createEdgeCmsClient({ baseUrl: 'https://foo.com' })).toThrow()
  })

  it('fetches collection list with query parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: '1', title: 'First Post' }],
        meta: { total: 1, page: 1, perPage: 20 },
      }),
    })

    const client = createEdgeCmsClient({
      baseUrl: 'https://cms.example.com',
      tenantSlug: 'acme',
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    })

    const res = await client.collection('posts').list({
      page: 2,
      perPage: 15,
      locale: 'ms',
      sort: '-createdAt',
      filter: { category: 'tech' },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl] = mockFetch.mock.calls[0] as [string]
    expect(calledUrl).toContain('https://cms.example.com/api/tenants/acme/public/posts?')
    expect(calledUrl).toContain('page=2')
    expect(calledUrl).toContain('perPage=15')
    expect(calledUrl).toContain('locale=ms')
    expect(calledUrl).toContain('sort=-createdAt')
    expect(calledUrl).toContain('category=tech')
    expect(res.data).toHaveLength(1)
  })

  it('fetches single entry with preview token support', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'entry-123', slug: 'my-post', title: 'Draft Post' }),
    })

    const client = createEdgeCmsClient({
      baseUrl: 'https://cms.example.com',
      tenantSlug: 'acme',
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    })

    const res = await client.collection('posts').get('my-post', {
      locale: 'en',
      depth: 2,
      previewToken: 'test.preview.token',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toContain('/api/tenants/acme/public/posts/my-post?')
    expect(calledUrl).toContain('previewToken=test.preview.token')
    expect(calledUrl).toContain('depth=2')
    expect(calledInit.headers).toMatchObject({
      'x-edgecms-preview-token': 'test.preview.token',
    })
    expect(res.slug).toBe('my-post')
  })

  it('fetches singleton entry', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 's1', siteTitle: 'Acme Official' }),
    })

    const client = createEdgeCmsClient({
      baseUrl: 'https://cms.example.com',
      tenantSlug: 'acme',
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    })

    const res = await client.collection('site-settings').getSingleton()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl] = mockFetch.mock.calls[0] as [string]
    expect(calledUrl).toContain('/api/tenants/acme/public/singleton/site-settings?')
    expect(res.siteTitle).toBe('Acme Official')
  })

  it('requests ephemeral preview token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'signed.hmac.preview.token',
        tenantSlug: 'acme',
        expiresAt: '2026-10-09T12:00:00Z',
        exp: 1770000000,
      }),
    })

    const client = createEdgeCmsClient({
      baseUrl: 'https://cms.example.com',
      tenantSlug: 'acme',
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    })

    const res = await client.createPreviewToken({
      entrySlug: 'draft-post',
      collectionSlug: 'posts',
      ttlSeconds: 600,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('https://cms.example.com/api/tenants/acme/public/preview-token')
    expect(calledInit.method).toBe('POST')
    expect(res.token).toBe('signed.hmac.preview.token')
  })

  it('generates asset URL with variants and formats', () => {
    const client = createEdgeCmsClient({
      baseUrl: 'https://cms.example.com',
      tenantSlug: 'acme',
    })

    const rawUrl = client.getAssetUrl('asset-123')
    expect(rawUrl).toBe('https://cms.example.com/api/tenants/acme/public/assets/asset-123/original')

    const transformUrl = client.getAssetUrl('asset-123', {
      variant: 'thumbnail',
      format: 'webp',
      width: 400,
      height: 300,
      fit: 'cover',
    })
    expect(transformUrl).toContain('/api/tenants/acme/public/assets/asset-123/thumbnail.webp?')
    expect(transformUrl).toContain('w=400')
    expect(transformUrl).toContain('h=300')
    expect(transformUrl).toContain('fit=cover')
  })

  it('throws helpful error on HTTP failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Entry not found',
    })

    const client = createEdgeCmsClient({
      baseUrl: 'https://cms.example.com',
      tenantSlug: 'acme',
      fetch: mockFetch as unknown as typeof globalThis.fetch,
    })

    expect(client.collection('posts').get('non-existent')).rejects.toThrow('EdgeCMS get request failed (404)')
  })
})
