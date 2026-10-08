import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import type { Database } from '@/database/db'

// Mock dependencies before importing the service
const mockAssetsService = {
  resolvePublicVariant: mock(),
}
const mockKvService = {
  getCurrentVersion: mock(),
  getVersionedKey: mock(),
  getSnapshot: mock(),
  putSnapshot: mock(),
}
const mockSnapshotService = {
  generateListSnapshot: mock(),
  generateEntrySnapshot: mock(),
  generateCacheTags: mock(),
  storeCacheTags: mock(),
}
const mockPublicRepository = {
  findCollectionBySlug: mock(),
  findFirstVisibleEntryForCollection: mock(),
}
const mockComputeDynamicTTL = mock()

mock.module('../../assets/assets.service', () => ({ assetsService: mockAssetsService }))
mock.module('../../cache/kv.service', () => ({ kvService: mockKvService }))
mock.module('../../cache/snapshot.service', () => ({ snapshotService: mockSnapshotService }))
mock.module('../../public/public.repository', () => ({ publicRepository: mockPublicRepository }))
mock.module('../../scheduling/ttl.service', () => ({ computeDynamicTTL: mockComputeDynamicTTL }))

const { publicService } = await import(`../../public/public.service?bypass=${Date.now()}`)

describe('publicService', () => {
  const db = {} as Database
  const kv = {} as KVNamespace
  const r2 = {
    get: mock(),
  } as unknown as R2Bucket

  beforeEach(() => {
    vi.clearAllMocks()
    mockKvService.getCurrentVersion.mockResolvedValue(1)
    mockKvService.getVersionedKey.mockImplementation((key: string, version: number, tenantId?: string) =>
      tenantId ? `t:${tenantId}:v${version}:${key}` : `v${version}:${key}`
    )
    mockComputeDynamicTTL.mockResolvedValue(60)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // getAssetVariant
  // ==========================================================================
  describe('getAssetVariant', () => {
    it('returns a Response with immutable cache headers when variant is found', async () => {
      mockAssetsService.resolvePublicVariant.mockResolvedValue({
        success: true,
        data: { key: 'assets/a1/variants/md.webp', contentType: 'image/webp' },
      })
      ;(r2 as unknown as { get: ReturnType<typeof mock> }).get.mockResolvedValue({
        body: new ReadableStream(),
      })

      const result = await publicService.getAssetVariant({
        db,
        r2,
        assetId: 'a1',
        variantParam: 'md',
        accept: 'image/webp',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        const response = result.data as Response
        expect(response.headers.get('Cache-Control')).toBe(
          'public, max-age=31536000, immutable'
        )
        expect(response.headers.get('CDN-Cache-Control')).toBe('public, max-age=31536000')
        expect(response.headers.get('Content-Type')).toBe('image/webp')
      }
    })

    it('strips format extension from variant param (e.g. md.webp -> md)', async () => {
      mockAssetsService.resolvePublicVariant.mockResolvedValue({
        success: true,
        data: { key: 'assets/a1/variants/md.webp', contentType: 'image/webp' },
      })
      ;(r2 as unknown as { get: ReturnType<typeof mock> }).get.mockResolvedValue({
        body: new ReadableStream(),
      })

      await publicService.getAssetVariant({
        db,
        r2,
        assetId: 'a1',
        variantParam: 'md.webp',
        accept: null,
      })

      expect(mockAssetsService.resolvePublicVariant).toHaveBeenCalledWith(
        db,
        'a1',
        'md',
        null,
        undefined
      )
    })

    it('returns 404 when variant resolution fails', async () => {
      mockAssetsService.resolvePublicVariant.mockResolvedValue({
        success: false,
        error: { message: 'Variant not found' },
      })

      const result = await publicService.getAssetVariant({
        db,
        r2,
        assetId: 'a1',
        variantParam: 'xl',
        accept: null,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.status).toBe(404)
      }
    })

    it('falls back to original when optimized variant object is missing', async () => {
      mockAssetsService.resolvePublicVariant.mockResolvedValue({
        success: true,
        data: { key: 'assets/a1/variants/md.webp', contentType: 'image/webp' },
      })
      mockAssetsService.resolvePublicVariant.mockResolvedValueOnce({
        success: true,
        data: { key: 'assets/a1/variants/md.webp', contentType: 'image/webp' },
      })
      mockAssetsService.resolvePublicVariant.mockResolvedValueOnce({
        success: true,
        data: { key: 'assets/a1/original/logo.png', contentType: 'image/png' },
      })
      ;(r2 as unknown as { get: ReturnType<typeof mock> }).get.mockResolvedValueOnce(null)
      ;(r2 as unknown as { get: ReturnType<typeof mock> }).get.mockResolvedValueOnce({
        body: new ReadableStream(),
      })

      const result = await publicService.getAssetVariant({
        db,
        r2,
        assetId: 'a1',
        variantParam: 'md',
        accept: null,
      })

      expect(result.success).toBe(true)
      expect(mockAssetsService.resolvePublicVariant).toHaveBeenNthCalledWith(
        2,
        db,
        'a1',
        'md',
        null,
        undefined
      )
      expect((r2 as unknown as { get: ReturnType<typeof mock> }).get).toHaveBeenNthCalledWith(
        2,
        'assets/a1/original/logo.png'
      )
      if (result.success) {
        expect(result.data.headers.get('Content-Type')).toBe('image/png')
      }
    })

    it('passes tenantId through to resolvePublicVariant', async () => {
      mockAssetsService.resolvePublicVariant.mockResolvedValue({
        success: false,
        error: { message: 'not found' },
      })

      await publicService.getAssetVariant({
        db,
        r2,
        assetId: 'a1',
        variantParam: 'md',
        accept: null,
        tenantId: 'tenant-1',
      })

      expect(mockAssetsService.resolvePublicVariant).toHaveBeenCalledWith(
        db,
        'a1',
        'md',
        null,
        'tenant-1'
      )
    })
  })

  // ==========================================================================
  // getCollectionList
  // ==========================================================================
  describe('getCollectionList', () => {
    it('returns cached snapshot when KV hit occurs', async () => {
      const cachedData = { entries: [{ id: 'e1' }], total: 1 }
      mockKvService.getSnapshot.mockImplementation((_: KVNamespace, __: string, tracker) => {
        tracker?.recordHit('kv')
        return Promise.resolve(cachedData)
      })
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })

      const result = await publicService.getCollectionList({
        db,
        kv,
        collectionSlug: 'posts',
        locale: 'en',
        page: 1,
        perPage: 25,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.payload).toEqual(cachedData)
        expect(result.data.cache.cacheTag).toBe('collection:posts,locale:en')
        expect(result.data.cache.debugHeaders['X-Cache-Status']).toBe('HIT')
        expect(result.data.cache.debugHeaders['X-Cache-Source']).toBe('kv')
      }
      // Should not generate a new snapshot
      expect(mockSnapshotService.generateListSnapshot).not.toHaveBeenCalled()
      expect(mockPublicRepository.findCollectionBySlug).not.toHaveBeenCalled()
      expect(mockComputeDynamicTTL).not.toHaveBeenCalled()
    })

    it('generates and stores snapshot on KV miss', async () => {
      const generatedSnapshot = { entries: [{ id: 'e1' }], total: 1 }
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })
      mockSnapshotService.generateListSnapshot.mockResolvedValue(generatedSnapshot)
      mockSnapshotService.generateCacheTags.mockReturnValue(['collection:c1', 'locale:en'])

      const result = await publicService.getCollectionList({
        db,
        kv,
        collectionSlug: 'posts',
        locale: 'en',
        page: 1,
        perPage: 25,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.payload).toEqual(generatedSnapshot)
      }
      expect(mockSnapshotService.generateListSnapshot).toHaveBeenCalledWith(
        db,
        'posts',
        'en',
        undefined,
        { page: 1, perPage: 25 },
        {
          extraConditions: expect.arrayContaining([]),
          orderByClause: undefined,
        },
        expect.objectContaining({ id: 'c1', slug: 'posts' })
      )
      expect(mockKvService.putSnapshot).toHaveBeenCalled()
      expect(mockSnapshotService.storeCacheTags).toHaveBeenCalled()
    })

    it('returns 404 when snapshot generation returns null', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })
      mockSnapshotService.generateListSnapshot.mockResolvedValue(null)

      const result = await publicService.getCollectionList({
        db,
        kv,
        collectionSlug: 'missing',
        locale: 'en',
        page: 1,
        perPage: 25,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.status).toBe(404)
        expect(result.error.message).toBe('Collection not found')
      }
    })

    it('returns 404 when collection is missing before generation', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue(null)

      const result = await publicService.getCollectionList({
        db,
        kv,
        collectionSlug: 'posts',
        locale: 'en',
        page: 1,
        perPage: 25,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.status).toBe(404)
      }
      expect(mockSnapshotService.generateListSnapshot).not.toHaveBeenCalled()
    })

    it('includes correct locale in cache tag', async () => {
      mockKvService.getSnapshot.mockResolvedValue({ entries: [] })
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })

      const result = await publicService.getCollectionList({
        db,
        kv,
        collectionSlug: 'posts',
        locale: 'fr',
        page: 1,
        perPage: 25,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.cache.cacheTag).toBe('collection:posts,locale:fr')
      }
    })

    it('keeps tenant-scoped KV keying on cache hit without repository calls', async () => {
      mockKvService.getSnapshot.mockResolvedValue({ entries: [] })

      await publicService.getCollectionList({
        db,
        kv,
        collectionSlug: 'posts',
        locale: 'en',
        page: 1,
        perPage: 25,
        tenantId: 'tenant-1',
      })

      expect(mockKvService.getCurrentVersion).toHaveBeenCalledWith(
        kv,
        'posts',
        'en',
        'tenant-1'
      )
      expect(mockKvService.getVersionedKey).toHaveBeenCalledWith(
        expect.stringContaining('snapshot:posts:en:list'),
        1,
        'tenant-1'
      )
      expect(mockPublicRepository.findCollectionBySlug).not.toHaveBeenCalled()
    })

    it('does not cross-return cached list snapshots between tenants with same slug, filter, and locale', async () => {
      const snapshotsByKey = new Map<string, unknown>()
      const params = {
        db,
        kv,
        collectionSlug: 'posts',
        locale: 'en',
        page: 1,
        perPage: 25,
        filters: [{ field: 'status', operator: 'eq', value: 'published' }],
      }

      mockKvService.getSnapshot.mockImplementation((_: KVNamespace, key: string) =>
        Promise.resolve(snapshotsByKey.get(key) ?? null)
      )
      mockKvService.putSnapshot.mockImplementation(
        (_: KVNamespace, key: string, snapshot: unknown) => {
          snapshotsByKey.set(key, snapshot)
          return Promise.resolve()
        }
      )
      mockPublicRepository.findCollectionBySlug.mockImplementation(
        (_: Database, collectionSlug: string, tenantId?: string) =>
          Promise.resolve({ id: `${tenantId}-${collectionSlug}`, slug: collectionSlug })
      )
      mockSnapshotService.generateListSnapshot.mockImplementation(
        (_: Database, collectionSlug: string, locale: string, tenantId?: string) =>
          Promise.resolve({
            tenantId,
            locale,
            entries: [{ id: `${tenantId}-entry`, slug: collectionSlug }],
            total: 1,
            generatedAt: '2026-06-04T00:00:00.000Z',
          })
      )
      mockSnapshotService.generateCacheTags.mockImplementation((collectionId: string) => [
        `collection:${collectionId}`,
        'locale:en',
      ])

      const tenantAFirst = await publicService.getCollectionList({ ...params, tenantId: 'tenant-a' })
      const tenantBFirst = await publicService.getCollectionList({ ...params, tenantId: 'tenant-b' })
      const tenantASecond = await publicService.getCollectionList({ ...params, tenantId: 'tenant-a' })

      expect(tenantAFirst.success).toBe(true)
      expect(tenantBFirst.success).toBe(true)
      expect(tenantASecond.success).toBe(true)
      if (tenantAFirst.success && tenantBFirst.success && tenantASecond.success) {
        expect(tenantAFirst.data.payload).toEqual({
          tenantId: 'tenant-a',
          locale: 'en',
          entries: [{ id: 'tenant-a-entry', slug: 'posts' }],
          total: 1,
          generatedAt: '2026-06-04T00:00:00.000Z',
        })
        expect(tenantBFirst.data.payload).toEqual({
          tenantId: 'tenant-b',
          locale: 'en',
          entries: [{ id: 'tenant-b-entry', slug: 'posts' }],
          total: 1,
          generatedAt: '2026-06-04T00:00:00.000Z',
        })
        expect(tenantASecond.data.payload).toEqual(tenantAFirst.data.payload)
      }
      expect(mockSnapshotService.generateListSnapshot).toHaveBeenCalledTimes(2)
      const storedKeys = Array.from(snapshotsByKey.keys()).sort()
      expect(storedKeys).toHaveLength(2)
      expect(storedKeys[0]).toMatch(/^t:tenant-a:v1:snapshot:posts:en:list:1:25:.+/)
      expect(storedKeys[1]).toMatch(/^t:tenant-b:v1:snapshot:posts:en:list:1:25:.+/)
      expect(storedKeys[0]?.replace('tenant-a', 'tenant-b')).toBe(storedKeys[1])
    })

    it('keys list snapshots by filters and sort params', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })
      mockSnapshotService.generateListSnapshot.mockResolvedValue({ entries: [] })
      mockSnapshotService.generateCacheTags.mockReturnValue(['collection:c1', 'locale:en'])

      const result = await publicService.getCollectionList({
        db,
        kv,
        collectionSlug: 'posts',
        locale: 'en',
        page: 2,
        perPage: 10,
        filters: [{ field: 'status', operator: 'eq', value: 'published' }],
        sort: [{ field: 'updatedAt', direction: 'desc' }],
      })

      expect(result.success).toBe(true)
      expect(mockKvService.getVersionedKey).toHaveBeenCalledWith(
        expect.stringMatching(/^snapshot:posts:en:list:2:10:(?!none$).+/),
        1,
        undefined
      )
      expect(mockSnapshotService.generateListSnapshot).toHaveBeenCalledWith(
        db,
        'posts',
        'en',
        undefined,
        { page: 2, perPage: 10 },
        {
          extraConditions: expect.arrayContaining([expect.any(Object)]),
          orderByClause: expect.any(Object),
        },
        expect.objectContaining({ id: 'c1', slug: 'posts' })
      )
    })

    it('resolves cache TTLs from dynamic TTL computation', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })
      mockSnapshotService.generateListSnapshot.mockResolvedValue({ entries: [] })
      mockSnapshotService.generateCacheTags.mockReturnValue(['collection:c1', 'locale:en'])
      // Dynamic TTL returns 30 for both calls (lower than defaults)
      mockComputeDynamicTTL.mockResolvedValue(30)

      const result = await publicService.getCollectionList({
        db,
        kv,
        collectionSlug: 'posts',
        locale: 'en',
        page: 1,
        perPage: 25,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.cache.browserTTL).toBeLessThanOrEqual(60)
        expect(result.data.cache.cdnTTL).toBeLessThanOrEqual(300)
      }
      expect(mockComputeDynamicTTL).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // getCollectionEntry
  // ==========================================================================
  describe('getCollectionEntry', () => {
    it('returns cached entry snapshot on KV hit', async () => {
      const cachedData = { entry: { id: 'e1', title: 'Hello' } }
      mockKvService.getSnapshot.mockImplementation((_: KVNamespace, __: string, tracker) => {
        tracker?.recordHit('kv')
        return Promise.resolve(cachedData)
      })
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })

      const result = await publicService.getCollectionEntry({
        db,
        kv,
        collectionSlug: 'posts',
        idOrSlug: 'e1',
        locale: 'en',
        populateParam: '',
        depth: 1,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.payload).toEqual(cachedData)
        expect(result.data.cache.cacheTag).toBe('collection:posts,locale:en,entry:e1')
        expect(result.data.cache.debugHeaders['X-Cache-Source']).toBe('kv')
      }
      expect(mockPublicRepository.findCollectionBySlug).not.toHaveBeenCalled()
      expect(mockComputeDynamicTTL).not.toHaveBeenCalled()
    })

    it('passes tenantId through to all downstream calls', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })
      mockSnapshotService.generateEntrySnapshot.mockResolvedValue({
        entry: { id: 'e1' },
      })
      mockSnapshotService.generateCacheTags.mockReturnValue([])

      await publicService.getCollectionEntry({
        db,
        kv,
        collectionSlug: 'posts',
        idOrSlug: 'e1',
        locale: 'en',
        populateParam: '',
        depth: 1,
        tenantId: 'tenant-1',
      })

      expect(mockKvService.getCurrentVersion).toHaveBeenCalledWith(
        kv,
        'posts',
        'en',
        'tenant-1'
      )
      expect(mockPublicRepository.findCollectionBySlug).toHaveBeenCalledWith(
        db,
        'posts',
        'tenant-1'
      )
      expect(mockSnapshotService.generateEntrySnapshot).toHaveBeenCalledWith(
        db,
        'posts',
        'e1',
        'en',
        'tenant-1',
        { populate: [], depth: 1 },
        expect.objectContaining({ id: 'c1', slug: 'posts' })
      )
    })

    it('generates and caches snapshot on KV miss', async () => {
      const generatedSnapshot = { entry: { id: 'e1' } }
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })
      mockSnapshotService.generateEntrySnapshot.mockResolvedValue(generatedSnapshot)
      mockSnapshotService.generateCacheTags.mockReturnValue(['collection:c1', 'entry:e1'])

      const result = await publicService.getCollectionEntry({
        db,
        kv,
        collectionSlug: 'posts',
        idOrSlug: 'e1',
        locale: 'en',
        populateParam: '',
        depth: 1,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.payload).toEqual(generatedSnapshot)
      }
      expect(mockKvService.putSnapshot).toHaveBeenCalled()
      expect(mockSnapshotService.storeCacheTags).toHaveBeenCalled()
    })

    it('returns 404 when entry snapshot generation returns null', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })
      mockSnapshotService.generateEntrySnapshot.mockResolvedValue(null)

      const result = await publicService.getCollectionEntry({
        db,
        kv,
        collectionSlug: 'posts',
        idOrSlug: 'missing',
        locale: 'en',
        populateParam: '',
        depth: 1,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.status).toBe(404)
        expect(result.error.message).toBe('Entry not found or not published')
      }
    })

    it('clamps depth between 1 and 3', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })
      mockSnapshotService.generateEntrySnapshot.mockResolvedValue({
        entry: { id: 'e1' },
      })
      mockSnapshotService.generateCacheTags.mockReturnValue([])

      // Depth too high - should clamp to 3
      await publicService.getCollectionEntry({
        db,
        kv,
        collectionSlug: 'posts',
        idOrSlug: 'e1',
        locale: 'en',
        populateParam: 'author',
        depth: 99,
      })

      expect(mockSnapshotService.generateEntrySnapshot).toHaveBeenCalledWith(
        db,
        'posts',
        'e1',
        'en',
        undefined,
        { populate: ['author'], depth: 3 },
        expect.objectContaining({ id: 'c1', slug: 'posts' })
      )
    })

    it('normalizes populate param with deduplication and sorting', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })
      mockSnapshotService.generateEntrySnapshot.mockResolvedValue({
        entry: { id: 'e1' },
      })
      mockSnapshotService.generateCacheTags.mockReturnValue([])

      await publicService.getCollectionEntry({
        db,
        kv,
        collectionSlug: 'posts',
        idOrSlug: 'e1',
        locale: 'en',
        populateParam: 'tags, author, tags',
        depth: 1,
      })

      // fieldNames should be deduplicated and sorted
      expect(mockSnapshotService.generateEntrySnapshot).toHaveBeenCalledWith(
        db,
        'posts',
        'e1',
        'en',
        undefined,
        { populate: ['author', 'tags'], depth: 1 },
        expect.objectContaining({ id: 'c1', slug: 'posts' })
      )
    })

    it('handles wildcard populate param', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
      })
      mockSnapshotService.generateEntrySnapshot.mockResolvedValue({
        entry: { id: 'e1' },
      })
      mockSnapshotService.generateCacheTags.mockReturnValue([])

      await publicService.getCollectionEntry({
        db,
        kv,
        collectionSlug: 'posts',
        idOrSlug: 'e1',
        locale: 'en',
        populateParam: '*',
        depth: 1,
      })

      expect(mockSnapshotService.generateEntrySnapshot).toHaveBeenCalledWith(
        db,
        'posts',
        'e1',
        'en',
        undefined,
        { populate: ['*'], depth: 1 },
        expect.objectContaining({ id: 'c1', slug: 'posts' })
      )
    })

    it('returns 404 when collection is missing before generation', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue(null)

      const result = await publicService.getCollectionEntry({
        db,
        kv,
        collectionSlug: 'posts',
        idOrSlug: 'e1',
        locale: 'en',
        populateParam: '',
        depth: 1,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.status).toBe(404)
        expect(result.error.message).toBe('Collection not found')
      }
      expect(mockSnapshotService.generateEntrySnapshot).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // getSingletonEntry
  // ==========================================================================
  describe('getSingletonEntry', () => {
    it('returns cached singleton snapshot on KV hit', async () => {
      const cachedData = { entry: { id: 'e1' } }
      mockKvService.getSnapshot.mockImplementation((_: KVNamespace, __: string, tracker) => {
        tracker?.recordHit('kv')
        return Promise.resolve(cachedData)
      })
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'settings',
        singleton: true,
      })

      const result = await publicService.getSingletonEntry({
        db,
        kv,
        collectionSlug: 'settings',
        locale: 'en',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.payload).toEqual(cachedData)
        expect(result.data.cache.cacheTag).toBe('collection:settings,locale:en')
        expect(result.data.cache.debugHeaders['X-Cache-Status']).toBe('HIT')
        expect(result.data.cache.debugHeaders['X-Cache-Source']).toBe('kv')
      }
      expect(mockPublicRepository.findCollectionBySlug).not.toHaveBeenCalled()
      expect(mockComputeDynamicTTL).not.toHaveBeenCalled()
    })

    it('returns 404 when collection not found', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue(null)

      const result = await publicService.getSingletonEntry({
        db,
        kv,
        collectionSlug: 'missing',
        locale: 'en',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.status).toBe(404)
        expect(result.error.message).toBe('Collection not found')
      }
    })

    it('returns 400 when collection is not a singleton', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'posts',
        singleton: false,
      })

      const result = await publicService.getSingletonEntry({
        db,
        kv,
        collectionSlug: 'posts',
        locale: 'en',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.status).toBe(400)
        expect(result.error.message).toBe('Collection is not a singleton')
      }
    })

    it('returns 404 when no published entry exists for singleton', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'settings',
        singleton: true,
      })
      mockPublicRepository.findFirstVisibleEntryForCollection.mockResolvedValue(undefined)

      const result = await publicService.getSingletonEntry({
        db,
        kv,
        collectionSlug: 'settings',
        locale: 'en',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.status).toBe(404)
        expect(result.error.message).toBe('No published entry found for singleton collection')
      }
    })

    it('generates and caches singleton snapshot on miss', async () => {
      const generatedSnapshot = { entry: { id: 'e1' } }
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'settings',
        singleton: true,
      })
      mockPublicRepository.findFirstVisibleEntryForCollection.mockResolvedValue({
        id: 'e1',
        collectionId: 'c1',
      })
      mockSnapshotService.generateEntrySnapshot.mockResolvedValue(generatedSnapshot)
      mockSnapshotService.generateCacheTags.mockReturnValue([
        'collection:c1',
        'entry:e1',
        'locale:en',
      ])

      const result = await publicService.getSingletonEntry({
        db,
        kv,
        collectionSlug: 'settings',
        locale: 'en',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.payload).toEqual(generatedSnapshot)
      }
      expect(mockKvService.putSnapshot).toHaveBeenCalled()
      expect(mockSnapshotService.storeCacheTags).toHaveBeenCalled()
    })

    it('returns 404 when snapshot generation fails for singleton', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'settings',
        singleton: true,
      })
      mockPublicRepository.findFirstVisibleEntryForCollection.mockResolvedValue({
        id: 'e1',
      })
      mockSnapshotService.generateEntrySnapshot.mockResolvedValue(null)

      const result = await publicService.getSingletonEntry({
        db,
        kv,
        collectionSlug: 'settings',
        locale: 'en',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.status).toBe(404)
        expect(result.error.message).toBe('Failed to generate snapshot')
      }
    })

    it('passes tenantId through to all downstream calls', async () => {
      mockKvService.getSnapshot.mockResolvedValue(null)
      mockPublicRepository.findCollectionBySlug.mockResolvedValue({
        id: 'c1',
        slug: 'settings',
        singleton: true,
      })
      mockPublicRepository.findFirstVisibleEntryForCollection.mockResolvedValue({
        id: 'e1',
      })
      mockSnapshotService.generateEntrySnapshot.mockResolvedValue({
        entry: { id: 'e1' },
      })
      mockSnapshotService.generateCacheTags.mockReturnValue([])

      await publicService.getSingletonEntry({
        db,
        kv,
        collectionSlug: 'settings',
        locale: 'en',
        tenantId: 'tenant-1',
      })

      expect(mockKvService.getCurrentVersion).toHaveBeenCalledWith(
        kv,
        'settings',
        'en',
        'tenant-1'
      )
      expect(mockPublicRepository.findCollectionBySlug).toHaveBeenCalledWith(
        db,
        'settings',
        'tenant-1'
      )
      expect(mockSnapshotService.generateEntrySnapshot).toHaveBeenCalledWith(
        db,
        'settings',
        'e1',
        'en',
        'tenant-1',
        undefined,
        expect.objectContaining({ id: 'c1', slug: 'settings' })
      )
    })
  })
})
