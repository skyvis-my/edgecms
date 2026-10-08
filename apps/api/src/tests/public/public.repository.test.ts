import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import type { Database } from '@/database/db'

// Mock the upstream repositories
const mockCollectionsRepository = {
  findBySlug: mock(),
}
const mockEntriesRepository = {
  findVisibleByCollection: mock(),
}

mock.module('../../collections/collections.repository', () => ({
  collectionsRepository: mockCollectionsRepository,
}))
mock.module('../../entries/entries.repository', () => ({
  entriesRepository: mockEntriesRepository,
}))

const { publicRepository } = await import(`../../public/public.repository?bypass=${Date.now()}`)

describe('publicRepository', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // findCollectionBySlug
  // ==========================================================================
  describe('findCollectionBySlug', () => {
    it('delegates to collectionsRepository.findBySlug', async () => {
      const mockCollection = { id: 'c1', slug: 'posts', name: 'Posts' }
      mockCollectionsRepository.findBySlug.mockResolvedValue(mockCollection)

      const result = await publicRepository.findCollectionBySlug(db, 'posts')

      expect(result).toEqual(mockCollection)
      expect(mockCollectionsRepository.findBySlug).toHaveBeenCalledWith(db, 'posts', undefined)
    })

    it('passes tenantId to collectionsRepository.findBySlug', async () => {
      mockCollectionsRepository.findBySlug.mockResolvedValue(null)

      await publicRepository.findCollectionBySlug(db, 'posts', 'tenant-1')

      expect(mockCollectionsRepository.findBySlug).toHaveBeenCalledWith(db, 'posts', 'tenant-1')
    })

    it('returns null when collection does not exist', async () => {
      mockCollectionsRepository.findBySlug.mockResolvedValue(null)

      const result = await publicRepository.findCollectionBySlug(db, 'nonexistent')

      expect(result).toBeNull()
    })

    it('returns the collection with all its fields', async () => {
      const fullCollection = {
        id: 'c1',
        slug: 'articles',
        name: 'Articles',
        singleton: false,
        fields: [{ name: 'title', type: 'text' }],
        tenantId: 'tenant-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      mockCollectionsRepository.findBySlug.mockResolvedValue(fullCollection)

      const result = await publicRepository.findCollectionBySlug(db, 'articles', 'tenant-1')

      expect(result).toEqual(fullCollection)
    })
  })

  // ==========================================================================
  // findFirstVisibleEntryForCollection
  // ==========================================================================
  describe('findFirstVisibleEntryForCollection', () => {
    it('returns the first visible entry for a collection', async () => {
      const entry = { id: 'e1', collectionId: 'c1', status: 'published', slug: 'hello-world' }
      mockEntriesRepository.findVisibleByCollection.mockResolvedValue({
        rows: [entry],
        total: 5,
      })

      const result = await publicRepository.findFirstVisibleEntryForCollection(db, 'c1')

      expect(result).toEqual(entry)
      expect(mockEntriesRepository.findVisibleByCollection).toHaveBeenCalledWith(db, {
        collectionId: 'c1',
        page: 1,
        perPage: 1,
      })
    })

    it('returns undefined when no visible entries exist', async () => {
      mockEntriesRepository.findVisibleByCollection.mockResolvedValue({
        rows: [],
        total: 0,
      })

      const result = await publicRepository.findFirstVisibleEntryForCollection(db, 'c1')

      expect(result).toBeUndefined()
    })

    it('always requests page 1 with perPage 1', async () => {
      mockEntriesRepository.findVisibleByCollection.mockResolvedValue({
        rows: [],
        total: 0,
      })

      await publicRepository.findFirstVisibleEntryForCollection(db, 'c1')

      expect(mockEntriesRepository.findVisibleByCollection).toHaveBeenCalledWith(db, {
        collectionId: 'c1',
        page: 1,
        perPage: 1,
      })
    })

    it('returns only the first row even if more are returned', async () => {
      const entries = [
        { id: 'e1', collectionId: 'c1', status: 'published' },
        { id: 'e2', collectionId: 'c1', status: 'published' },
      ]
      mockEntriesRepository.findVisibleByCollection.mockResolvedValue({
        rows: entries,
        total: 2,
      })

      const result = await publicRepository.findFirstVisibleEntryForCollection(db, 'c1')

      expect(result).toEqual(entries[0])
    })
  })
})
