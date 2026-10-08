import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { EntryRow } from '@/entries/entries.repository'
import type { RelationRow } from '../../relations/relations.repository'

const { relationsResolver } = await import(
  `../../relations/relations.resolver?bypass=${Date.now()}`
)

vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: {
    findById: vi.fn(),
    findByIds: vi.fn(),
  },
}))

vi.mock('../../relations/relations.repository', () => ({
  relationsRepository: {
    findBySourceEntry: vi.fn(),
  },
}))

import { entriesRepository } from '@/entries/entries.repository'
import { relationsRepository } from '../../relations/relations.repository'

const mockEntriesRepo = entriesRepository as unknown as {
  findById: ReturnType<typeof vi.fn>
  findByIds: ReturnType<typeof vi.fn>
}
const mockRelRepo = relationsRepository as unknown as {
  findBySourceEntry: ReturnType<typeof vi.fn>
}

describe('relationsResolver', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('populate', () => {
    it('populates relation fields on an entry', async () => {
      const entry = makeEntry({ id: 'e1', data: { title: 'Post', author: null } })
      const targetEntry = makeEntry({ id: 'e2', data: { name: 'Author Name' } })

      mockRelRepo.findBySourceEntry.mockResolvedValue([
        makeRelation({
          sourceEntryId: 'e1',
          targetEntryId: 'e2',
          fieldName: 'author',
          relationType: 'one-to-one',
        }),
      ])
      mockEntriesRepo.findByIds.mockResolvedValue([targetEntry])
      // Recursive populate: no further relations on target
      mockRelRepo.findBySourceEntry.mockResolvedValueOnce([
        makeRelation({
          sourceEntryId: 'e1',
          targetEntryId: 'e2',
          fieldName: 'author',
          relationType: 'one-to-one',
        }),
      ])

      const result = await relationsResolver.populate(db, entry)
      expect(result.data.author).toBeDefined()
    })

    it('returns entry unchanged when visited (circular reference prevention)', async () => {
      const entry = makeEntry({ id: 'e1' })
      const visited = new Set(['e1'])

      const result = await relationsResolver.populate(db, entry, [], 1, 3, visited)
      expect(result).toBe(entry)
      // Should NOT have called findBySourceEntry
      expect(mockRelRepo.findBySourceEntry).not.toHaveBeenCalled()
    })

    it('stops recursion at max depth', async () => {
      const entry = makeEntry({ id: 'e1' })

      const result = await relationsResolver.populate(db, entry, [], 4, 3)
      expect(result).toBe(entry)
      expect(mockRelRepo.findBySourceEntry).not.toHaveBeenCalled()
    })

    it('returns entry unchanged when no relations exist', async () => {
      const entry = makeEntry({ id: 'e1', data: { title: 'Test' } })
      mockRelRepo.findBySourceEntry.mockResolvedValue([])

      const result = await relationsResolver.populate(db, entry)
      expect(result.data).toEqual({ title: 'Test' })
    })

    it('populates one-to-one as single object', async () => {
      const entry = makeEntry({ id: 'e1', data: {} })
      const target = makeEntry({ id: 'e2', data: { name: 'Author' } })

      mockRelRepo.findBySourceEntry
        .mockResolvedValueOnce([
          makeRelation({
            sourceEntryId: 'e1',
            targetEntryId: 'e2',
            fieldName: 'author',
            relationType: 'one-to-one',
          }),
        ])
        .mockResolvedValue([]) // No further relations on target

      mockEntriesRepo.findByIds.mockResolvedValue([target])

      const result = await relationsResolver.populate(db, entry, ['author'], 1, 2)
      // one-to-one should be a single object (not array)
      expect(result.data.author).toBeDefined()
      expect(Array.isArray(result.data.author)).toBe(false)
    })

    it('populates many-to-many as array', async () => {
      const entry = makeEntry({ id: 'e1', data: {} })
      const tag1 = makeEntry({ id: 't1', data: { name: 'Tag1' } })
      const tag2 = makeEntry({ id: 't2', data: { name: 'Tag2' } })

      mockRelRepo.findBySourceEntry
        .mockResolvedValueOnce([
          makeRelation({
            sourceEntryId: 'e1',
            targetEntryId: 't1',
            fieldName: 'tags',
            relationType: 'many-to-many',
          }),
          makeRelation({
            sourceEntryId: 'e1',
            targetEntryId: 't2',
            fieldName: 'tags',
            relationType: 'many-to-many',
          }),
        ])
        .mockResolvedValue([])

      mockEntriesRepo.findByIds.mockResolvedValueOnce([tag1, tag2])

      const result = await relationsResolver.populate(db, entry, ['tags'], 1, 2)
      expect(Array.isArray(result.data.tags)).toBe(true)
      expect((result.data.tags as unknown[]).length).toBe(2)
    })

    it('populates all relation fields when no fieldNames specified', async () => {
      const entry = makeEntry({ id: 'e1', data: {} })

      mockRelRepo.findBySourceEntry
        .mockResolvedValueOnce([
          makeRelation({
            sourceEntryId: 'e1',
            targetEntryId: 'e2',
            fieldName: 'author',
            relationType: 'one-to-one',
          }),
          makeRelation({
            sourceEntryId: 'e1',
            targetEntryId: 'e3',
            fieldName: 'category',
            relationType: 'one-to-one',
          }),
        ])
        .mockResolvedValue([])

      mockEntriesRepo.findByIds.mockResolvedValueOnce([
        makeEntry({ id: 'e2', data: { name: 'Auth' } }),
        makeEntry({ id: 'e3', data: { name: 'Cat' } }),
      ])

      const result = await relationsResolver.populate(db, entry, [])
      expect(result.data.author).toBeDefined()
      expect(result.data.category).toBeDefined()
    })

    it('skips missing target entries gracefully', async () => {
      const entry = makeEntry({ id: 'e1', data: {} })

      mockRelRepo.findBySourceEntry
        .mockResolvedValueOnce([
          makeRelation({
            sourceEntryId: 'e1',
            targetEntryId: 'missing',
            fieldName: 'author',
            relationType: 'one-to-one',
          }),
        ])
        .mockResolvedValue([])

      mockEntriesRepo.findByIds.mockResolvedValue([])

      const result = await relationsResolver.populate(db, entry, ['author'], 1, 2)
      // one-to-one with no targets returns null
      expect(result.data.author).toBeNull()
    })
  })

  describe('batchFetchEntries', () => {
    it('returns empty array for empty input', async () => {
      const result = await relationsResolver.batchFetchEntries(db, [])
      expect(result).toEqual([])
      expect(mockEntriesRepo.findByIds).not.toHaveBeenCalled()
    })

    it('fetches multiple entries in parallel', async () => {
      const e1 = makeEntry({ id: 'e1' })
      const e2 = makeEntry({ id: 'e2' })
      mockEntriesRepo.findByIds.mockResolvedValueOnce([e1, e2])

      const result = await relationsResolver.batchFetchEntries(db, ['e1', 'e2'])
      expect(result).toHaveLength(2)
      expect(mockEntriesRepo.findByIds).toHaveBeenCalledWith(db, ['e1', 'e2'], undefined)
    })

    it('filters out undefined results', async () => {
      mockEntriesRepo.findByIds.mockResolvedValueOnce([makeEntry({ id: 'e1' })])

      const result = await relationsResolver.batchFetchEntries(db, ['e1', 'missing'])
      expect(result).toHaveLength(1)
    })
  })
})

// ============================================================================
// Helpers
// ============================================================================

function makeEntry(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: 'test-entry',
    collectionId: 'c1',
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

function makeRelation(overrides: Partial<RelationRow> = {}): RelationRow {
  return {
    id: 'test-relation',
    sourceEntryId: 'e1',
    targetEntryId: 'e2',
    sourceCollectionId: 'c1',
    targetCollectionId: 'c2',
    relationType: 'one-to-many',
    fieldName: 'related',
    sortOrder: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}
