import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'
import { applyPublicAssetFormatAliases } from '@/public/public-assets-path-normalizer'

const mockDb = {} as D1Database
const mockKv = {} as KVNamespace
const mockR2 = {
  get: vi.fn(),
} as unknown as R2Bucket
const kvService = {
  getCurrentVersion: vi.fn(),
  incrementVersion: vi.fn(),
  getVersionedKey: vi.fn(),
  getSnapshot: vi.fn(),
  putSnapshot: vi.fn(),
}
const snapshotService = {
  generateListSnapshot: vi.fn(),
  generateEntrySnapshot: vi.fn(),
  generateCacheTags: vi.fn(),
  storeCacheTags: vi.fn(),
}
const collectionsRepository = {
  findAll: vi.fn(),
  findBySlug: vi.fn(),
}
const entriesRepository = {
  findAll: vi.fn(),
  findVisibleByCollection: vi.fn(),
}
const publicRepository = {
  findCollectionBySlug: vi.fn(),
  findFirstVisibleEntryForCollection: vi.fn(),
}
const computeDynamicTTL = vi.fn()

vi.mock('cloudflare:workers', () => ({
  env: { DB: mockDb, CACHE: mockKv, MEDIA: mockR2 },
}))
vi.mock('@/tenants/tenant-context', () => ({
  hasTenantContext: (ctx: unknown) =>
    typeof ctx === 'object' &&
    ctx !== null &&
    'tenant' in ctx &&
    typeof (ctx as { tenant: unknown }).tenant === 'object' &&
    (ctx as { tenant: unknown }).tenant !== null &&
    'tenant' in ((ctx as { tenant: unknown }).tenant as object) &&
    'resources' in ((ctx as { tenant: unknown }).tenant as object),
  getTenantContext: (ctx: { tenant: unknown }) => ctx.tenant,
  resolveTenantBindings: () => ({ db: mockDb, kv: mockKv, r2: mockR2 }),
  verifyTenantMembership: vi.fn(async () => 'owner'),
}))
const assetsService = {
  getPublicVariant: vi.fn(),
  resolvePublicVariant: vi.fn(),
}
vi.mock('@/assets/assets.service', () => ({ assetsService }))
vi.mock('@/cache/kv.service', () => ({ kvService }))
vi.mock('@/cache/snapshot.service', () => ({ snapshotService }))
vi.mock('@/collections/collections.repository', () => ({ collectionsRepository }))
vi.mock('@/entries/entries.repository', () => ({ entriesRepository }))
vi.mock('@/public/public.repository', () => ({ publicRepository }))
vi.mock('@/scheduling/ttl.service', () => ({ computeDynamicTTL }))

const { publicController } = await import(`../../public/public.controller?bypass=${Date.now()}`)

describe('publicController', () => {
  const app = applyPublicAssetFormatAliases(new Elysia().use(publicController))

  beforeEach(() => {
    vi.clearAllMocks()
    kvService.getCurrentVersion.mockResolvedValue(1)
    kvService.getVersionedKey.mockImplementation((key: string) => `v1:${key}`)
    computeDynamicTTL.mockResolvedValue(60)
    collectionsRepository.findBySlug.mockResolvedValue({
      id: 'c1',
      slug: 'posts',
      singleton: false,
    })
    collectionsRepository.findAll.mockResolvedValue([])
    publicRepository.findCollectionBySlug.mockResolvedValue({
      id: 'c1',
      slug: 'posts',
      singleton: false,
    })
    snapshotService.generateCacheTags.mockReturnValue(['collection:c1', 'locale:en'])
  })

  it('GET /:collectionSlug returns cached list snapshot and sets cache headers', async () => {
    kvService.getSnapshot.mockResolvedValueOnce({ data: { entries: [] } })

    const response = await app.handle(new Request('http://localhost/api/public/posts?locale=en'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('max-age=')
    expect(response.headers.get('cache-control')).toContain('stale-while-revalidate=')
    expect(response.headers.get('cache-control')).toContain('stale-if-error=')
    expect(response.headers.get('cdn-cache-control')).toContain('max-age=')
    expect(response.headers.get('cdn-cache-control')).toContain('stale-while-revalidate=')
    expect(response.headers.get('cdn-cache-control')).toContain('stale-if-error=')
    expect(response.headers.get('cache-tag')).toContain('collection:posts')
    expect(response.headers.get('x-edgecms-cache')).toBe('hit')
  })

  it('GET /:collectionSlug keys cached list snapshots by locale', async () => {
    kvService.getSnapshot.mockResolvedValueOnce({ entries: [{ id: 'ms-entry' }] })

    const response = await app.handle(new Request('http://localhost/api/public/posts?locale=ms'))

    expect(response.status).toBe(200)
    expect(kvService.getCurrentVersion).toHaveBeenCalledWith(mockKv, 'posts', 'ms', undefined)
    expect(kvService.getVersionedKey).toHaveBeenCalledWith(
      expect.stringContaining('snapshot:posts:ms:list'),
      1,
      undefined
    )
    expect(response.headers.get('cache-tag')).toBe('collection:posts,locale:ms')
    expect(response.headers.get('x-edgecms-cache')).toBe('hit')
  })

  it('GET /:collectionSlug returns stable error shape and no-store for invalid filters', async () => {
    const response = await app.handle(new Request('http://localhost/api/public/posts?filter[id]=e1'))

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('x-edgecms-cache')).toBe('miss')
    expect(await response.json()).toEqual({
      error: 'Invalid filter parameters',
      details: [
        'Field "id" is not filterable. Allowed top-level fields: slug, createdAt, updatedAt, status. Use data.fieldName for custom fields.',
      ],
    })
    expect(kvService.getSnapshot).not.toHaveBeenCalled()
  })

  it('GET /:collectionSlug rejects draft status filters before public snapshot lookup', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/public/posts?filter[status]=draft')
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('x-edgecms-cache')).toBe('miss')
    expect(await response.json()).toEqual({
      error: 'Invalid filter parameters',
      details: ['Public status filters only support published content.'],
    })
    expect(kvService.getSnapshot).not.toHaveBeenCalled()
  })

  it('GET /:collectionSlug returns 404 when list snapshot cannot be generated', async () => {
    kvService.getSnapshot.mockResolvedValueOnce(null)
    snapshotService.generateListSnapshot.mockResolvedValueOnce(null)

    const response = await app.handle(new Request('http://localhost/api/public/missing'))
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'Collection not found' })
  })

  it('GET /:collectionSlug returns 404 when collection lookup fails after generation', async () => {
    kvService.getSnapshot.mockResolvedValueOnce(null)
    snapshotService.generateListSnapshot.mockResolvedValueOnce(null)
    collectionsRepository.findBySlug.mockResolvedValueOnce(null)

    const response = await app.handle(new Request('http://localhost/api/public/posts'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Collection not found' })
  })

  it('GET /:collectionSlug/:entryIdOrSlug handles snapshot miss, depth clamp, and cache store', async () => {
    kvService.getSnapshot.mockResolvedValueOnce(null)
    snapshotService.generateEntrySnapshot.mockResolvedValueOnce({
      data: { collection: { id: 'c1' } },
      entry: { id: 'e1' },
      locale: 'en',
      generatedAt: new Date().toISOString(),
    })

    const response = await app.handle(
      new Request('http://localhost/api/public/posts/entry-1?populate=author&depth=99')
    )
    expect(response.status).toBe(200)
    expect(kvService.getVersionedKey).toHaveBeenCalledWith(
      expect.stringContaining(':entry:entry-1:author:3'),
      1,
      undefined
    )
    expect(snapshotService.generateEntrySnapshot).toHaveBeenCalledWith(
      mockDb,
      'posts',
      'entry-1',
      'en',
      undefined,
      {
        populate: ['author'],
        depth: 3,
      },
      expect.objectContaining({ id: 'c1', slug: 'posts' })
    )
    expect(kvService.putSnapshot).toHaveBeenCalled()
    expect(snapshotService.storeCacheTags).toHaveBeenCalled()
  })

  it('GET /:collectionSlug/:entryIdOrSlug passes tenant and locale into public cache proof', async () => {
    const tenantApp = applyPublicAssetFormatAliases(
      new Elysia()
        .derive(() => ({
          tenant: {
            tenant: { id: 'tenant-a', slug: 'acme' },
            resources: {},
          },
        }))
        .use(publicController)
    )
    kvService.getSnapshot.mockResolvedValueOnce(null)
    snapshotService.generateEntrySnapshot.mockResolvedValueOnce({
      data: { collection: { id: 'c1' } },
      entry: { id: 'e1' },
      locale: 'fr',
      generatedAt: new Date().toISOString(),
    })

    const response = await tenantApp.handle(
      new Request('http://localhost/api/public/posts/entry-1?locale=fr')
    )

    expect(response.status).toBe(200)
    expect(kvService.getCurrentVersion).toHaveBeenCalledWith(mockKv, 'posts', 'fr', 'tenant-a')
    expect(kvService.getVersionedKey).toHaveBeenCalledWith(
      expect.stringContaining('snapshot:posts:fr:entry:entry-1:none:1'),
      1,
      'tenant-a'
    )
    expect(snapshotService.generateEntrySnapshot).toHaveBeenCalledWith(
      mockDb,
      'posts',
      'entry-1',
      'fr',
      'tenant-a',
      {
        populate: [],
        depth: 1,
      },
      expect.objectContaining({ id: 'c1', slug: 'posts' })
    )
    expect(response.headers.get('cache-tag')).toBe('collection:posts,locale:fr,entry:entry-1')
  })

  it('GET /:collectionSlug handles list snapshot miss by storing snapshot and tags', async () => {
    kvService.getSnapshot.mockResolvedValueOnce(null)
    snapshotService.generateListSnapshot.mockResolvedValueOnce({
      data: { entries: [] },
      collection: { id: 'c1' },
      locale: 'en',
      generatedAt: new Date().toISOString(),
    })
    collectionsRepository.findBySlug.mockResolvedValue({
      id: 'c1',
      slug: 'posts',
      singleton: false,
    })

    const response = await app.handle(new Request('http://localhost/api/public/posts'))
    expect(response.status).toBe(200)
    expect(kvService.putSnapshot).toHaveBeenCalled()
    expect(snapshotService.generateCacheTags).toHaveBeenCalledWith('c1', undefined, 'en')
    expect(snapshotService.storeCacheTags).toHaveBeenCalled()
  })

  it('GET /:collectionSlug passes page and perPage to list snapshot generation', async () => {
    kvService.getSnapshot.mockResolvedValue(null)
    snapshotService.generateListSnapshot.mockResolvedValueOnce({
      collection: { id: 'c1', name: 'Posts', slug: 'posts' },
      locale: 'en',
      entries: [{ id: 'e3' }],
      generatedAt: new Date().toISOString(),
      total: 1,
    })

    const response = await app.handle(
      new Request('http://localhost/api/public/posts?page=2&perPage=1')
    )
    const body = (await response.json()) as { entries: Array<{ id: string }> }

    expect(response.status).toBe(200)
    expect(snapshotService.generateListSnapshot).toHaveBeenCalledWith(
      mockDb,
      'posts',
      'en',
      undefined,
      { page: 2, perPage: 1 },
      { extraConditions: [], orderByClause: undefined },
      expect.objectContaining({ id: 'c1', slug: 'posts' })
    )
    expect(body.entries).toEqual([{ id: 'e3' }])
  })

  it('GET /:collectionSlug passes raw filter query params through route schema', async () => {
    kvService.getSnapshot.mockResolvedValue(null)
    snapshotService.generateListSnapshot.mockResolvedValueOnce({
      collection: { id: 'c1', name: 'Posts', slug: 'posts' },
      locale: 'en',
      entries: [{ id: 'e3' }],
      generatedAt: new Date().toISOString(),
      total: 1,
    })

    const response = await app.handle(
      new Request(
        'http://localhost/api/public/posts?filter[status]=published&sort=-updatedAt&page=2&perPage=1'
      )
    )

    expect(response.status).toBe(200)
    expect(snapshotService.generateListSnapshot).toHaveBeenCalledWith(
      mockDb,
      'posts',
      'en',
      undefined,
      { page: 2, perPage: 1 },
      {
        extraConditions: expect.arrayContaining([expect.any(Object)]),
        orderByClause: expect.any(Object),
      },
      expect.objectContaining({ id: 'c1', slug: 'posts' })
    )
  })

  it('GET /:collectionSlug/:entryIdOrSlug returns 404 when entry snapshot generation fails', async () => {
    kvService.getSnapshot.mockResolvedValueOnce(null)
    snapshotService.generateEntrySnapshot.mockResolvedValueOnce(null)

    const response = await app.handle(new Request('http://localhost/api/public/posts/missing'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Entry not found or not published' })
  })

  it('GET /:collectionSlug/:entryIdOrSlug returns 404 when collection lookup fails after entry generation', async () => {
    kvService.getSnapshot.mockResolvedValueOnce(null)
    snapshotService.generateEntrySnapshot.mockResolvedValueOnce(null)

    const response = await app.handle(new Request('http://localhost/api/public/posts/entry-1'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Entry not found or not published' })
  })

  it('GET /singleton/:collectionSlug validates singleton preconditions', async () => {
    // Test 1: Missing collection
    kvService.getSnapshot.mockResolvedValue(null)
    publicRepository.findCollectionBySlug.mockResolvedValueOnce(null)
    const missingCollection = await app.handle(
      new Request('http://localhost/api/public/singleton/posts')
    )
    expect(missingCollection.status).toBe(404)

    // Test 2: Not a singleton - the singleton endpoint returns 400
    kvService.getSnapshot.mockResolvedValue(null)
    publicRepository.findCollectionBySlug.mockResolvedValueOnce({
      id: 'c1',
      slug: 'posts',
      singleton: false,
    })
    const notSingleton = await app.handle(
      new Request('http://localhost/api/public/singleton/posts')
    )
    expect(notSingleton.status).toBe(400)

    // Test 3: No published entry
    kvService.getSnapshot.mockResolvedValue(null)
    publicRepository.findCollectionBySlug.mockResolvedValueOnce({
      id: 'c1',
      slug: 'posts',
      singleton: true,
    })
    publicRepository.findFirstVisibleEntryForCollection.mockResolvedValueOnce(undefined)
    const noPublished = await app.handle(new Request('http://localhost/api/public/singleton/posts'))
    expect(noPublished.status).toBe(404)
  })

  it('GET /singleton/:collectionSlug stores generated snapshot on miss', async () => {
    kvService.getSnapshot.mockResolvedValueOnce(null)
    publicRepository.findCollectionBySlug.mockResolvedValue({ id: 'c1', slug: 'posts', singleton: true })
    publicRepository.findFirstVisibleEntryForCollection.mockResolvedValueOnce({
      id: 'e1', collectionId: 'c1', slug: 'hello', status: 'published',
    })
    snapshotService.generateEntrySnapshot.mockResolvedValueOnce({
      data: { collection: { id: 'c1' } },
      entry: { id: 'e1' },
      locale: 'en',
      generatedAt: new Date().toISOString(),
    })

    const response = await app.handle(new Request('http://localhost/api/public/singleton/posts'))
    expect(response.status).toBe(200)
    expect(kvService.putSnapshot).toHaveBeenCalled()
    expect(snapshotService.storeCacheTags).toHaveBeenCalled()
  })

  it('serves singleton via /api/public/:singleton slug alias', async () => {
    kvService.getSnapshot.mockResolvedValueOnce(null) // list miss
    snapshotService.generateListSnapshot.mockResolvedValueOnce(null)
    collectionsRepository.findBySlug.mockResolvedValue({ id: 'c1', slug: 'site-settings', singleton: true })
    publicRepository.findCollectionBySlug.mockResolvedValue({ id: 'c1', slug: 'site-settings', singleton: true })
    publicRepository.findFirstVisibleEntryForCollection.mockResolvedValueOnce({
      id: 'e1', collectionId: 'c1', slug: 'site-settings', status: 'published',
    })
    snapshotService.generateEntrySnapshot.mockResolvedValueOnce({
      data: { collection: { id: 'c1' } },
      entry: { id: 'e1' },
      locale: 'en',
      generatedAt: new Date().toISOString(),
    })

    const response = await app.handle(new Request('http://localhost/api/public/site-settings'))
    expect(response.status).toBe(200)
  })

  it('GET /singleton/:collectionSlug uses visibility query for prefetch without explicit status filter', async () => {
    kvService.getSnapshot.mockResolvedValueOnce(null)
    publicRepository.findCollectionBySlug.mockResolvedValue({ id: 'c1', slug: 'posts', singleton: true })
    publicRepository.findFirstVisibleEntryForCollection.mockResolvedValueOnce({
      id: 'e1', collectionId: 'c1', slug: 'hello', status: 'scheduled',
    })
    snapshotService.generateEntrySnapshot.mockResolvedValueOnce({
      data: { collection: { id: 'c1' } },
      entry: { id: 'e1' },
      locale: 'en',
      generatedAt: new Date().toISOString(),
    })

    const response = await app.handle(new Request('http://localhost/api/public/singleton/posts'))
    expect(response.status).toBe(200)
    // Verify the singleton endpoint uses findFirstVisibleEntryForCollection for prefetch
    expect(publicRepository.findFirstVisibleEntryForCollection).toHaveBeenCalledWith(mockDb, 'c1')
  })

  it('GET /singleton/:collectionSlug returns 404 when entry snapshot cannot be generated', async () => {
    kvService.getSnapshot.mockResolvedValueOnce(null)
    publicRepository.findCollectionBySlug.mockResolvedValue({ id: 'c1', slug: 'posts', singleton: true })
    publicRepository.findFirstVisibleEntryForCollection.mockResolvedValueOnce({
      id: 'e1', collectionId: 'c1', slug: 'hello', status: 'published',
    })
    snapshotService.generateEntrySnapshot.mockResolvedValueOnce(null)

    const response = await app.handle(new Request('http://localhost/api/public/singleton/posts'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Failed to generate snapshot' })
  })

  it('GET /assets/:assetId/:variant.:format serves explicit format when present', async () => {
    assetsService.getPublicVariant.mockResolvedValue({
      object: {
        body: new ReadableStream(),
        httpMetadata: { contentType: 'image/webp' },
      },
    })

    const response = await app.handle(
      new Request('http://localhost/api/public/assets/a1/md.webp', {
        headers: { accept: 'image/avif,image/webp' },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('immutable')
    expect(response.headers.get('cdn-cache-control')).toContain('max-age=31536000')
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('x-edgecms-cache')).toBe('hit')
  })

  it('GET /assets/:assetId/:variant.:format falls back to original when explicit variant is missing', async () => {
    assetsService.getPublicVariant.mockResolvedValue(null)
    assetsService.resolvePublicVariant.mockResolvedValue({
      success: true,
      data: { key: 'assets/a1/original/ar-logo.png', contentType: 'image/png' },
    })
    mockR2.get = vi.fn().mockResolvedValue({
      body: new ReadableStream(),
    } as unknown as R2ObjectBody)

    const response = await app.handle(
      new Request('http://localhost/api/public/assets/a1/medium.webp', {
        headers: { accept: 'image/avif,image/webp' },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/png')
    expect(assetsService.resolvePublicVariant).toHaveBeenCalledWith(
      mockDb,
      'a1',
      'medium',
      'image/avif,image/webp',
      undefined
    )
    expect(mockR2.get).toHaveBeenCalledWith('assets/a1/original/ar-logo.png')
  })

  it('GET /assets/:assetId/:variant negotiates and serves best Accept match', async () => {
    assetsService.resolvePublicVariant.mockResolvedValue({
      success: true,
      data: { key: 'variants/a1/md.avif', contentType: 'image/avif' },
    })
    mockR2.get = vi.fn().mockResolvedValue({
      body: new ReadableStream(),
    } as unknown as R2ObjectBody)

    const response = await app.handle(
      new Request('http://localhost/api/public/assets/a1/md', {
        headers: { accept: 'image/avif,image/webp' },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('max-age=31536000')
    expect(response.headers.get('cache-control')).toContain('immutable')
    expect(response.headers.get('cdn-cache-control')).toBe('public, max-age=31536000')
    expect(response.headers.get('content-type')).toContain('image/avif')
    expect(response.headers.get('x-edgecms-cache')).toBe('hit')
  })

  it('GET /assets/:assetId serves original asset and passes image transform query params', async () => {
    assetsService.resolvePublicVariant.mockResolvedValue({
      success: true,
      data: { key: 'original/photo.jpg', contentType: 'image/jpeg' },
    })
    mockR2.get = vi.fn().mockResolvedValue({
      body: new ReadableStream(),
    } as unknown as R2ObjectBody)

    const response = await app.handle(
      new Request('http://localhost/api/public/assets/photo-1?w=800&h=600&fit=cover&format=webp')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('max-age=31536000')
    expect(response.headers.get('content-type')).toContain('image/webp')
    expect(response.headers.get('x-image-transform')).toBe('fallback')
    const transformParams = JSON.parse(response.headers.get('x-image-transform-params') ?? '{}')
    expect(transformParams).toMatchObject({
      width: 800,
      height: 600,
      fit: 'cover',
      format: 'webp',
    })
  })
})
