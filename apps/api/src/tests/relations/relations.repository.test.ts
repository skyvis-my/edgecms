import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'

const { relationsRepository } = await import(
  `../../relations/relations.repository?bypass=${Date.now()}`
)

describe('relationsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('link', () => {
    it('creates a new relation and returns the row', async () => {
      const row = makeRelationRow({ id: 'r1' })
      const mockDb = createChainableDb({ returningResult: [row] })

      const result = await relationsRepository.link(mockDb as unknown as Database, {
        id: 'r1',
        sourceEntryId: 'e1',
        targetEntryId: 'e2',
        sourceCollectionId: 'c1',
        targetCollectionId: 'c2',
        relationType: 'one-to-many',
        fieldName: 'author',
        sortOrder: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      })

      expect(result).toEqual(row)
    })

    it('throws when insert fails (empty returning)', async () => {
      const mockDb = createChainableDb({ returningResult: [] })

      await expect(
        relationsRepository.link(mockDb as unknown as Database, {
          id: 'r1',
          sourceEntryId: 'e1',
          targetEntryId: 'e2',
          sourceCollectionId: 'c1',
          targetCollectionId: 'c2',
          relationType: 'one-to-many',
          fieldName: 'author',
          sortOrder: 0,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        })
      ).rejects.toThrow('Failed to create relation')
    })
  })

  describe('unlink', () => {
    it('returns true when relation is deleted', async () => {
      const mockDb = createChainableDb({ returningResult: [{ id: 'r1' }] })

      const result = await relationsRepository.unlink(mockDb as unknown as Database, 'r1')
      expect(result).toBe(true)
    })

    it('returns false when relation not found', async () => {
      const mockDb = createChainableDb({ returningResult: [] })

      const result = await relationsRepository.unlink(mockDb as unknown as Database, 'nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('unlinkByEntries', () => {
    it('deletes relation by source, target, and field', async () => {
      const mockDb = createChainableDb({ returningResult: [{ id: 'r1' }] })

      const result = await relationsRepository.unlinkByEntries(
        mockDb as unknown as Database,
        'e1',
        'e2',
        'author'
      )
      expect(result).toBe(true)
    })

    it('returns false when no matching relation', async () => {
      const mockDb = createChainableDb({ returningResult: [] })

      const result = await relationsRepository.unlinkByEntries(
        mockDb as unknown as Database,
        'e1',
        'e2',
        'missing-field'
      )
      expect(result).toBe(false)
    })
  })

  describe('findBySourceEntry', () => {
    it('returns relations for a source entry', async () => {
      const relations = [
        makeRelationRow({ sourceEntryId: 'e1', fieldName: 'tags' }),
        makeRelationRow({ sourceEntryId: 'e1', fieldName: 'author' }),
      ]
      const mockDb = createChainableDb({ selectResults: [relations] })

      const result = await relationsRepository.findBySourceEntry(
        mockDb as unknown as Database,
        'e1'
      )
      expect(result).toEqual(relations)
    })

    it('filters by fieldName when provided', async () => {
      const relations = [makeRelationRow({ sourceEntryId: 'e1', fieldName: 'tags' })]
      const mockDb = createChainableDb({ selectResults: [relations] })

      const result = await relationsRepository.findBySourceEntry(
        mockDb as unknown as Database,
        'e1',
        'tags'
      )
      expect(result).toEqual(relations)
    })
  })

  describe('findByTargetEntry', () => {
    it('returns relations pointing to a target entry', async () => {
      const relations = [makeRelationRow({ targetEntryId: 'e2' })]
      const mockDb = createChainableDb({ selectResults: [relations] })

      const result = await relationsRepository.findByTargetEntry(
        mockDb as unknown as Database,
        'e2'
      )
      expect(result).toEqual(relations)
    })
  })

  describe('findBySourceEntryAndField', () => {
    it('returns relations for specific source and field', async () => {
      const relations = [makeRelationRow({ sourceEntryId: 'e1', fieldName: 'category' })]
      const mockDb = createChainableDb({ selectResults: [relations] })

      const result = await relationsRepository.findBySourceEntryAndField(
        mockDb as unknown as Database,
        'e1',
        'category'
      )
      expect(result).toEqual(relations)
    })
  })

  describe('countBySourceEntryAndField', () => {
    it('returns the count of relations', async () => {
      const mockDb = createChainableDb({ selectResults: [[{ count: 3 }]] })

      const result = await relationsRepository.countBySourceEntryAndField(
        mockDb as unknown as Database,
        'e1',
        'tags'
      )
      expect(result).toBe(3)
    })

    it('returns 0 when no relations exist', async () => {
      const mockDb = createChainableDb({ selectResults: [[{ count: 0 }]] })

      const result = await relationsRepository.countBySourceEntryAndField(
        mockDb as unknown as Database,
        'e1',
        'tags'
      )
      expect(result).toBe(0)
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function makeRelationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'test-relation-id',
    sourceEntryId: 'source-entry-id',
    targetEntryId: 'target-entry-id',
    sourceCollectionId: 'source-collection-id',
    targetCollectionId: 'target-collection-id',
    relationType: 'one-to-many',
    fieldName: 'related',
    sortOrder: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function createChainableDb(opts: { selectResults?: unknown[][]; returningResult?: unknown[] }) {
  const selectResults = opts.selectResults ?? [[]]
  const returningResult = opts.returningResult ?? []
  let selectCallIndex = 0

  const makeSelectChain = () => {
    const currentResult = selectResults[selectCallIndex] ?? []
    selectCallIndex++

    const chainBase = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    }
    return Object.assign(Promise.resolve(currentResult), chainBase)
  }

  const returningPromise = Object.assign(Promise.resolve(returningResult), {})
  const mutationChain = {
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue(returningPromise),
  }

  return {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: vi.fn().mockReturnValue(mutationChain),
    update: vi.fn().mockReturnValue(mutationChain),
    delete: vi.fn().mockReturnValue(mutationChain),
  }
}
