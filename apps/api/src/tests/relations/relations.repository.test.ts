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

    it('scopes the delete to the tenant when tenantId is given (H1)', async () => {
      const mockDb = createChainableDb({ returningResult: [{ id: 'r1' }] })

      const result = await relationsRepository.unlinkByEntries(
        mockDb as unknown as Database,
        'e1',
        'e2',
        'author',
        't1'
      )
      expect(result).toBe(true)
      expect(mockDb.whereArgs).toHaveLength(1)
      expect(mentionsTenant(mockDb.whereArgs[0])).toBe(true)
    })

    it('omits the tenant filter when tenantId is absent (backward-compatible)', async () => {
      const mockDb = createChainableDb({ returningResult: [{ id: 'r1' }] })

      await relationsRepository.unlinkByEntries(
        mockDb as unknown as Database,
        'e1',
        'e2',
        'author'
      )
      expect(mockDb.whereArgs).toHaveLength(1)
      expect(mentionsTenant(mockDb.whereArgs[0])).toBe(false)
    })
  })

  describe('unlink tenant scope', () => {
    it('scopes delete-by-id to the tenant when tenantId is given', async () => {
      const mockDb = createChainableDb({ returningResult: [{ id: 'r1' }] })

      await relationsRepository.unlink(mockDb as unknown as Database, 'r1', 't1')
      expect(mockDb.whereArgs).toHaveLength(1)
      expect(mentionsTenant(mockDb.whereArgs[0])).toBe(true)
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

    it('scopes to the tenant when tenantId is given', async () => {
      const mockDb = createChainableDb({ selectResults: [[]] })

      await relationsRepository.findBySourceEntry(
        mockDb as unknown as Database,
        'e1',
        undefined,
        't1'
      )
      expect(mockDb.whereArgs).toHaveLength(1)
      expect(mentionsTenant(mockDb.whereArgs[0])).toBe(true)
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

    it('scopes to the tenant when tenantId is given', async () => {
      const mockDb = createChainableDb({ selectResults: [[]] })

      await relationsRepository.findByTargetEntry(mockDb as unknown as Database, 'e2', 't1')
      expect(mockDb.whereArgs).toHaveLength(1)
      expect(mentionsTenant(mockDb.whereArgs[0])).toBe(true)
    })
  })

  describe('findBySourceEntries', () => {
    it('scopes to the tenant when tenantId is given', async () => {
      const mockDb = createChainableDb({ selectResults: [[]] })

      await relationsRepository.findBySourceEntries(
        mockDb as unknown as Database,
        ['e1'],
        undefined,
        't1'
      )
      expect(mockDb.whereArgs).toHaveLength(1)
      expect(mentionsTenant(mockDb.whereArgs[0])).toBe(true)
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

    it('scopes to the tenant when tenantId is given', async () => {
      const mockDb = createChainableDb({ selectResults: [[]] })

      await relationsRepository.findBySourceEntryAndField(
        mockDb as unknown as Database,
        'e1',
        'category',
        't1'
      )
      expect(mockDb.whereArgs).toHaveLength(1)
      expect(mentionsTenant(mockDb.whereArgs[0])).toBe(true)
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

    it('scopes the count to the tenant when tenantId is given', async () => {
      const mockDb = createChainableDb({ selectResults: [[{ count: 1 }]] })

      const result = await relationsRepository.countBySourceEntryAndField(
        mockDb as unknown as Database,
        'e1',
        'tags',
        't1'
      )
      expect(result).toBe(1)
      expect(mockDb.whereArgs).toHaveLength(1)
      expect(mentionsTenant(mockDb.whereArgs[0])).toBe(true)
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Recursively check whether a drizzle WHERE condition references the
 * relations tenantId column. Drizzle conditions are SQL objects holding
 * `queryChunks`; columns carry a `name` and a `table` reference.
 */
function mentionsTenant(node: unknown, seen: Set<unknown> = new Set()): boolean {
  if (!node || typeof node !== 'object' || seen.has(node)) return false
  seen.add(node)
  const rec = node as Record<string, unknown>
  if (rec['name'] === 'tenantId' && 'table' in rec) return true
  if (Array.isArray(rec['queryChunks'])) {
    return (rec['queryChunks'] as unknown[]).some((chunk) => mentionsTenant(chunk, seen))
  }
  if (Array.isArray(node)) return node.some((item) => mentionsTenant(item, seen))
  return false
}

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
  const whereArgs: unknown[] = []

  const makeSelectChain = () => {
    const currentResult = selectResults[selectCallIndex] ?? []
    selectCallIndex++

    const chain = Object.assign(Promise.resolve(currentResult), {
      from: vi.fn().mockImplementation(() => chain),
      where: vi.fn().mockImplementation((cond: unknown) => {
        whereArgs.push(cond)
        return chain
      }),
      orderBy: vi.fn().mockImplementation(() => chain),
      limit: vi.fn().mockImplementation(() => chain),
    })
    return chain
  }

  const returningPromise = Object.assign(Promise.resolve(returningResult), {})
  const mutationChain = {
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation((cond: unknown) => {
      whereArgs.push(cond)
      return mutationChain
    }),
    returning: vi.fn().mockReturnValue(returningPromise),
  }

  return {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: vi.fn().mockReturnValue(mutationChain),
    update: vi.fn().mockReturnValue(mutationChain),
    delete: vi.fn().mockReturnValue(mutationChain),
    whereArgs,
  }
}
