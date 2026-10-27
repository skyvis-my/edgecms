import { describe, expect, it, vi } from 'bun:test'
import { buildQueryParams, createEdgeCmsClient } from '../client'
import {
  listenToDraftPreview,
  sendDraftPreviewUpdate,
  sendPreviewReadyNotification,
} from '../preview'

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
    expect(decodeURIComponent(calledUrl)).toContain('filter[data.category][eq]=tech')
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

describe('@edgecms/client Filter Query Serialization', () => {
  it('serializes plain object filters into filter[data.field][eq]=value', () => {
    const params = buildQueryParams({
      filter: {
        category: 'tech',
        featured: true,
        count: 10,
      },
    })

    expect(params.get('filter[data.category][eq]')).toBe('tech')
    expect(params.get('filter[data.featured][eq]')).toBe('true')
    expect(params.get('filter[data.count][eq]')).toBe('10')
  })

  it('serializes top-level fields (slug, status, createdAt, updatedAt) without data. prefix', () => {
    const params = buildQueryParams({
      filter: {
        slug: 'my-first-post',
        status: 'published',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
      },
    })

    expect(params.get('filter[slug][eq]')).toBe('my-first-post')
    expect(params.get('filter[status][eq]')).toBe('published')
    expect(params.get('filter[createdAt][eq]')).toBe('2026-01-01')
    expect(params.get('filter[updatedAt][eq]')).toBe('2026-01-02')
  })

  it('preserves existing data. prefix on custom fields', () => {
    const params = buildQueryParams({
      filter: {
        'data.title': 'Edge Computing',
        'data.author.name': 'Alice',
      },
    })

    expect(params.get('filter[data.title][eq]')).toBe('Edge Computing')
    expect(params.get('filter[data.author.name][eq]')).toBe('Alice')
  })

  it('supports structured operators: eq, ne, in, nin, contains, gt, gte, lt, lte', () => {
    const params = buildQueryParams({
      filter: {
        category: { eq: 'tech' },
        status: { ne: 'draft' },
        tags: { in: ['news', 'announcements'] },
        excluded: { nin: ['spam', 'archived'] },
        title: { contains: 'release' },
        rating: { gt: 4 },
        score: { gte: 80 },
        price: { lt: 100 },
        discount: { lte: 25 },
      },
    })

    expect(params.get('filter[data.category][eq]')).toBe('tech')
    expect(params.get('filter[status][ne]')).toBe('draft')
    expect(params.get('filter[data.tags][in]')).toBe('news,announcements')
    expect(params.get('filter[data.excluded][nin]')).toBe('spam,archived')
    expect(params.get('filter[data.title][contains]')).toBe('release')
    expect(params.get('filter[data.rating][gt]')).toBe('4')
    expect(params.get('filter[data.score][gte]')).toBe('80')
    expect(params.get('filter[data.price][lt]')).toBe('100')
    expect(params.get('filter[data.discount][lte]')).toBe('25')
  })

  it('supports multiple operators on the same field', () => {
    const params = buildQueryParams({
      filter: {
        price: { gte: 10, lte: 50 },
      },
    })

    expect(params.get('filter[data.price][gte]')).toBe('10')
    expect(params.get('filter[data.price][lte]')).toBe('50')
  })

  it('preserves pre-formatted filter keys and ignores undefined/null values', () => {
    const params = buildQueryParams({
      filter: {
        'filter[data.custom][eq]': 'already-formatted',
        emptyField: undefined,
        nullField: null,
      },
    })

    expect(params.get('filter[data.custom][eq]')).toBe('already-formatted')
    expect(params.has('filter[data.emptyField][eq]')).toBe(false)
    expect(params.has('filter[data.nullField][eq]')).toBe(false)
  })

  it('serializes standard pagination, sort, depth, locale, previewToken', () => {
    const params = buildQueryParams(
      {
        page: 3,
        perPage: 25,
        locale: 'zh',
        sort: '-createdAt,slug',
        depth: 2,
        previewToken: 'tok_abc123',
      },
      'en'
    )

    expect(params.get('page')).toBe('3')
    expect(params.get('perPage')).toBe('25')
    expect(params.get('locale')).toBe('zh')
    expect(params.get('sort')).toBe('-createdAt,slug')
    expect(params.get('depth')).toBe('2')
    expect(params.get('previewToken')).toBe('tok_abc123')
  })
})

describe('@edgecms/client SSR Safety', () => {
  it('sendPreviewReadyNotification executes safely when window is undefined without throwing ReferenceError', () => {
    const originalWindow = globalThis.window
    // @ts-expect-error simulating SSR
    delete globalThis.window

    try {
      expect(typeof window).toBe('undefined')
      expect(() => sendPreviewReadyNotification()).not.toThrow()
    } finally {
      if (originalWindow !== undefined) {
        globalThis.window = originalWindow
      }
    }
  })

  it('listenToDraftPreview returns no-op cleanup when window is undefined without throwing', () => {
    const originalWindow = globalThis.window
    // @ts-expect-error simulating SSR
    delete globalThis.window

    try {
      expect(typeof window).toBe('undefined')
      const cleanup = listenToDraftPreview(() => {})
      expect(typeof cleanup).toBe('function')
      expect(() => cleanup()).not.toThrow()
    } finally {
      if (originalWindow !== undefined) {
        globalThis.window = originalWindow
      }
    }
  })

  it('sendDraftPreviewUpdate does not throw when target window is undefined', () => {
    expect(() => sendDraftPreviewUpdate(undefined, { foo: 'bar' })).not.toThrow()
    expect(() => sendDraftPreviewUpdate(null, { foo: 'bar' })).not.toThrow()
  })
})

