import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { CollectionRow } from '@/collections/collections.repository'
import type { Database } from '@/database/db'
import type { EntryRow } from '@/entries/entries.repository'
import { asMockedObj } from '../../../test-utils/typed-mock'

const { snapshotService } = await import(`../../cache/snapshot.service?bypass=${Date.now()}`)

vi.mock('@/collections/collections.repository', () => ({
  collectionsRepository: {
    findBySlug: vi.fn(),
  },
}))

vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByCollectionAndSlug: vi.fn(),
    findVisibleByCollection: vi.fn(),
  },
}))

vi.mock('@/relations/relations.resolver', () => ({
  relationsResolver: {
    populate: vi.fn(),
  },
}))

vi.mock('@/database/schema', () => ({
  cacheTags: {
    snapshotKey: 'snapshotKey',
    tag: 'tag',
  },
}))

import { collectionsRepository } from '@/collections/collections.repository'
import { entriesRepository } from '@/entries/entries.repository'
import { relationsResolver } from '@/relations/relations.resolver'

const mockCollRepo = asMockedObj(collectionsRepository)
const mockEntriesRepo = asMockedObj(entriesRepository)
const mockResolver = asMockedObj(relationsResolver)

describe('snapshotService', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('generateListSnapshot', () => {
    it('returns null when collection not found', async () => {
      mockCollRepo.findBySlug.mockResolvedValue(undefined)

      const result = await snapshotService.generateListSnapshot(db, 'missing', 'en')
      expect(result).toBeNull()
    })

    it('generates snapshot of published entries with locale flattening', async () => {
      const collection = makeCollection({
        id: 'c1',
        name: 'Articles',
        slug: 'articles',
        fields: [
          { name: 'title', type: 'text', required: true, localizable: true },
          { name: 'count', type: 'number', required: false, localizable: false },
        ],
        defaultLocale: 'en',
      })
      mockCollRepo.findBySlug.mockResolvedValue(collection)

      const entry = makeEntry({
        id: 'e1',
        slug: 'hello',
        status: 'published',
        data: { title: { en: 'Hello', fr: 'Bonjour' }, count: 42 },
      })
      mockEntriesRepo.findVisibleByCollection.mockResolvedValue({ rows: [entry], total: 1 })

      // Resolver returns populated entry (no additional relations)
      mockResolver.populate.mockResolvedValue({
        ...entry,
        data: { title: { en: 'Hello', fr: 'Bonjour' }, count: 42 },
      })

      const result = await snapshotService.generateListSnapshot(db, 'articles', 'fr')

      expect(result).not.toBeNull()
      expect(result?.collection.slug).toBe('articles')
      expect(result?.locale).toBe('fr')
      expect(result?.entries).toHaveLength(1)
      // Localized title should be flattened to French
      expect(result?.entries[0].data.title).toBe('Bonjour')
      // Non-localized count should remain
      expect(result?.entries[0].data.count).toBe(42)
    })

    it('returns empty entries array when no published entries', async () => {
      mockCollRepo.findBySlug.mockResolvedValue(makeCollection({ slug: 'articles' }))
      mockEntriesRepo.findVisibleByCollection.mockResolvedValue({ rows: [], total: 0 })

      const result = await snapshotService.generateListSnapshot(db, 'articles', 'en')

      expect(result?.entries).toEqual([])
      expect(result?.total).toBe(0)
    })

    it('includes scheduled entries when publishAt has passed and unpublishAt is in the future', async () => {
      const now = Date.now()
      mockCollRepo.findBySlug.mockResolvedValue(makeCollection({ id: 'c1', slug: 'articles' }))
      const entry = makeEntry({
        id: 'e-scheduled-visible',
        collectionId: 'c1',
        status: 'scheduled',
        publishAt: new Date(now - 60_000).toISOString(),
        unpublishAt: new Date(now + 60_000).toISOString(),
      })
      mockEntriesRepo.findVisibleByCollection.mockResolvedValue({ rows: [entry], total: 1 })
      mockResolver.populate.mockResolvedValue({ ...entry, data: {} })

      const result = await snapshotService.generateListSnapshot(db, 'articles', 'en')
      expect(result?.entries).toHaveLength(1)
      expect(result?.entries[0]?.id).toBe('e-scheduled-visible')
    })
  })

  describe('generateEntrySnapshot', () => {
    it('returns null when collection not found', async () => {
      mockCollRepo.findBySlug.mockResolvedValue(undefined)

      const result = await snapshotService.generateEntrySnapshot(db, 'missing', 'e1', 'en')
      expect(result).toBeNull()
    })

    it('returns null when entry not found', async () => {
      mockCollRepo.findBySlug.mockResolvedValue(makeCollection({ id: 'c1' }))
      mockEntriesRepo.findById.mockResolvedValue(undefined)
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(undefined)

      const result = await snapshotService.generateEntrySnapshot(db, 'articles', 'missing', 'en')
      expect(result).toBeNull()
    })

    it('returns null when entry is not published', async () => {
      const collection = makeCollection({ id: 'c1' })
      mockCollRepo.findBySlug.mockResolvedValue(collection)
      mockEntriesRepo.findById.mockResolvedValue(
        makeEntry({ id: 'e1', collectionId: 'c1', status: 'draft' })
      )

      const result = await snapshotService.generateEntrySnapshot(db, 'articles', 'e1', 'en')
      expect(result).toBeNull()
    })

    it('generates snapshot for published entry', async () => {
      const collection = makeCollection({
        id: 'c1',
        slug: 'articles',
        fields: [{ name: 'title', type: 'text', required: true, localizable: true }],
        defaultLocale: 'en',
      })
      mockCollRepo.findBySlug.mockResolvedValue(collection)

      const entry = makeEntry({
        id: 'e1',
        collectionId: 'c1',
        slug: 'hello',
        status: 'published',
        data: { title: { en: 'Hello', fr: 'Bonjour' } },
      })
      mockEntriesRepo.findById.mockResolvedValue(entry)
      mockResolver.populate.mockResolvedValue({
        ...entry,
        data: { title: { en: 'Hello', fr: 'Bonjour' } },
      })

      const result = await snapshotService.generateEntrySnapshot(db, 'articles', 'e1', 'en')

      expect(result).not.toBeNull()
      expect(result?.entry.data.title).toBe('Hello')
    })

    it('skips relation population when query pattern has no populate fields', async () => {
      const collection = makeCollection({
        id: 'c1',
        slug: 'articles',
        fields: [{ name: 'title', type: 'text', required: true, localizable: true }],
        defaultLocale: 'en',
      })
      const entry = makeEntry({
        id: 'e1',
        collectionId: 'c1',
        status: 'published',
        data: { title: { en: 'Hello' } },
      })

      mockCollRepo.findBySlug.mockResolvedValue(collection)
      mockEntriesRepo.findById.mockResolvedValue(entry)

      const result = await snapshotService.generateEntrySnapshot(db, 'articles', 'e1', 'en', undefined, {
        populate: [],
        depth: 3,
      })

      expect(result).not.toBeNull()
      expect(mockResolver.populate).not.toHaveBeenCalled()
    })

    it('applies query pattern populate fields and depth when provided', async () => {
      const collection = makeCollection({
        id: 'c1',
        slug: 'articles',
        fields: [{ name: 'title', type: 'text', required: true, localizable: true }],
        defaultLocale: 'en',
      })
      const entry = makeEntry({
        id: 'e1',
        collectionId: 'c1',
        status: 'published',
        data: { title: { en: 'Hello' } },
      })

      mockCollRepo.findBySlug.mockResolvedValue(collection)
      mockEntriesRepo.findById.mockResolvedValue(entry)
      mockResolver.populate.mockResolvedValue(entry)

      await snapshotService.generateEntrySnapshot(db, 'articles', 'e1', 'en', undefined, {
        populate: ['author'],
        depth: 3,
      })

      expect(mockResolver.populate).toHaveBeenCalledWith(db, entry, ['author'], 1, 3, new Set(), undefined)
    })

    it('excludes published entry when unpublishAt has passed', async () => {
      const now = Date.now()
      const collection = makeCollection({ id: 'c1', slug: 'articles' })
      const expiredEntry = makeEntry({
        id: 'e-expired',
        collectionId: 'c1',
        status: 'published',
        unpublishAt: new Date(now - 30_000).toISOString(),
      })
      mockCollRepo.findBySlug.mockResolvedValue(collection)
      mockEntriesRepo.findById.mockResolvedValue(expiredEntry)

      const result = await snapshotService.generateEntrySnapshot(db, 'articles', 'e-expired', 'en')
      expect(result).toBeNull()
    })

    it('falls back to slug lookup when entry ID does not match collection', async () => {
      const collection = makeCollection({ id: 'c1', slug: 'articles' })
      mockCollRepo.findBySlug.mockResolvedValue(collection)
      mockEntriesRepo.findById.mockResolvedValue(
        makeEntry({ id: 'e1', collectionId: 'other-collection' })
      )
      const entryBySlug = makeEntry({
        id: 'e2',
        collectionId: 'c1',
        slug: 'hello',
        status: 'published',
        data: {},
      })
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(entryBySlug)
      mockResolver.populate.mockResolvedValue({ ...entryBySlug, data: {} })

      const result = await snapshotService.generateEntrySnapshot(db, 'articles', 'hello', 'en')
      expect(result).not.toBeNull()
      expect(result?.entry.id).toBe('e2')
    })

    it('passes tenantId through entry id and slug lookups', async () => {
      const collection = makeCollection({ id: 'c1', slug: 'articles', tenantId: 'tenant-smoke' })
      mockCollRepo.findBySlug.mockResolvedValue(collection)
      mockEntriesRepo.findById.mockResolvedValue(undefined)
      const entryBySlug = makeEntry({
        id: 'e-tenant',
        collectionId: 'c1',
        slug: 'hello',
        status: 'published',
        data: {},
      })
      mockEntriesRepo.findByCollectionAndSlug.mockResolvedValue(entryBySlug)
      mockResolver.populate.mockResolvedValue({ ...entryBySlug, data: {} })

      const result = await snapshotService.generateEntrySnapshot(
        db,
        'articles',
        'hello',
        'en',
        'tenant-smoke'
      )

      expect(result).not.toBeNull()
      expect(mockEntriesRepo.findById).toHaveBeenCalledWith(db, 'hello', 'tenant-smoke')
      expect(mockEntriesRepo.findByCollectionAndSlug).toHaveBeenCalledWith(
        db,
        'c1',
        'hello',
        'tenant-smoke'
      )
    })
  })

  describe('generateCacheTags', () => {
    it('generates collection tag', () => {
      const tags = snapshotService.generateCacheTags('c1')
      expect(tags).toContain('collection:c1')
    })

    it('includes entry tag when entryId provided', () => {
      const tags = snapshotService.generateCacheTags('c1', 'e1')
      expect(tags).toContain('collection:c1')
      expect(tags).toContain('entry:e1')
    })

    it('includes locale tag when locale provided', () => {
      const tags = snapshotService.generateCacheTags('c1', undefined, 'fr')
      expect(tags).toContain('collection:c1')
      expect(tags).toContain('locale:fr')
    })

    it('includes all tags when all params provided', () => {
      const tags = snapshotService.generateCacheTags('c1', 'e1', 'en')
      expect(tags).toEqual(['collection:c1', 'entry:e1', 'locale:en'])
    })
  })

  describe('storeCacheTags', () => {
    it('stores cache tags in the database', async () => {
      const mockDelete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      const mockInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      })
      const mockDb = { delete: mockDelete, insert: mockInsert } as unknown as Database

      const randomUuidSpy = vi
        .spyOn(crypto, 'randomUUID')
        .mockReturnValue('tag-uuid' as `${string}-${string}-${string}-${string}-${string}`)

      await snapshotService.storeCacheTags(mockDb, 'snapshot:articles:en:list', [
        'collection:c1',
        'locale:en',
      ])

      expect(mockDelete).toHaveBeenCalled()
      expect(mockInsert).toHaveBeenCalled()
      randomUuidSpy.mockRestore()
    })

    it('skips insert when tags array is empty', async () => {
      const mockDelete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      const mockInsert = vi.fn()
      const mockDb = { delete: mockDelete, insert: mockInsert } as unknown as Database

      await snapshotService.storeCacheTags(mockDb, 'snapshot:key', [])

      expect(mockDelete).toHaveBeenCalled()
      expect(mockInsert).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Helpers
// ============================================================================

function makeCollection(overrides: Partial<CollectionRow> = {}): CollectionRow {
  return {
    id: 'test-collection',
    tenantId: 'tenant-1',
    name: 'Test',
    slug: 'test',
    singleton: false,
    fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
    defaultLocale: 'en',
    supportedLocales: ['en'],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    displayName: null,
    description: null,
    icon: null,
    color: null,
    listFields: null,
    searchFields: null,
    defaultSort: null,
    defaultSortOrder: null,
    ...overrides,
  }
}

function makeEntry(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: 'test-entry',
    collectionId: 'test-collection',
    slug: 'test',
    status: 'published',
    data: {},
    version: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    publishAt: null,
    unpublishAt: null,
    ...overrides,
  }
}
