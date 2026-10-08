import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { entries } from '@/database/schema'
import type { SQL } from 'drizzle-orm'
import type { Database } from '@/database/db'

const mockAnd = vi.fn()
const mockGt = vi.fn()
const mockInArray = vi.fn()
const mockIsNull = vi.fn()
const mockLte = vi.fn()
const mockOr = vi.fn()
const mockSqlJoin = vi.fn()

const makeSqlNode = (type: string, payload: Record<string, unknown>) => {
  const node = { type, ...payload }
  Object.defineProperty(node, 'mapWith', {
    value: vi.fn(() => node),
    enumerable: false,
  })
  Object.defineProperty(node, 'as', {
    value: vi.fn(() => node),
    enumerable: false,
  })
  return node
}

vi.mock('drizzle-orm', () => {
  const mockSql = ((parts: TemplateStringsArray, ...values: unknown[]) => {
    return makeSqlNode('sql', { parts, values })
  }) as ((parts: TemplateStringsArray, ...values: unknown[]) => unknown) & {
    join: (clauses: unknown[], delimiter: unknown) => unknown
    raw: (value: string) => unknown
  }

  mockSql.join = (clauses: unknown[], delimiter: unknown) => {
    mockSqlJoin(clauses, delimiter)
    return makeSqlNode('sql.join', { clauses, delimiter })
  }
  mockSql.raw = (value: string) => makeSqlNode('sql.raw', { value })

  return {
    desc: (value: unknown) => {
      return makeSqlNode('desc', { value })
    },
    and: (...args: unknown[]) => {
      const node = makeSqlNode('and', { args })
      mockAnd(...args)
      return node
    },
    eq: (left: unknown, right: unknown) => {
      return makeSqlNode('eq', { left, right })
    },
    gt: (left: unknown, right: unknown) => {
      const node = makeSqlNode('gt', { left, right })
      mockGt(left, right)
      return node
    },
    inArray: (left: unknown, right: unknown) => {
      const node = makeSqlNode('inArray', { left, right })
      mockInArray(left, right)
      return node
    },
    isNull: (value: unknown) => {
      const node = makeSqlNode('isNull', { value })
      mockIsNull(value)
      return node
    },
    lte: (left: unknown, right: unknown) => {
      const node = makeSqlNode('lte', { left, right })
      mockLte(left, right)
      return node
    },
    or: (...args: unknown[]) => {
      const node = makeSqlNode('or', { args })
      mockOr(...args)
      return node
    },
    sql: mockSql,
  }
})

const { entriesRepository } = await import(`../../entries/entries.repository?bypass=${Date.now()}`)

describe('entriesRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('findAll', () => {
    it('returns rows and total count with default pagination', async () => {
      const mockRows = [makeEntryRow({ id: 'e1' }), makeEntryRow({ id: 'e2' })]
      const mockDb = createChainableDb({
        selectResults: [
          [{ count: 2 }], // count query
          mockRows, // rows query
        ],
      })

      const result = await entriesRepository.findAll(mockDb as unknown as Database)
      expect(result.rows).toEqual(mockRows)
      expect(result.total).toBe(2)
    })

    it('applies collectionId filter', async () => {
      const mockDb = createChainableDb({
        selectResults: [[{ count: 1 }], [makeEntryRow({ collectionId: 'c1' })]],
      })

      const result = await entriesRepository.findAll(mockDb as unknown as Database, {
        collectionId: 'c1',
      })

      expect(result.rows).toHaveLength(1)
      expect(result.total).toBe(1)
    })

    it('handles empty result set', async () => {
      const mockDb = createChainableDb({
        selectResults: [[{ count: 0 }], []],
      })

      const result = await entriesRepository.findAll(mockDb as unknown as Database)
      expect(result.rows).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('findVisibleByCollection', () => {
    it('builds visibility query with scheduled/published states and publish windows', async () => {
      const now = '2026-06-09T00:00:00.000Z'
      const visibleRows = [makeEntryRow({ id: 'e1', status: 'published' })]

      const whereClauses: unknown[] = []
      const selectResults = [[{ count: 1 }], visibleRows]

      const mockDb = createChainableDb({
        selectResults,
        onWhere: (condition) => {
          whereClauses.push(condition)
        },
      })
      const result = await entriesRepository.findVisibleByCollection(mockDb as unknown as Database, {
        collectionId: 'c1',
        now,
      })

      expect(result.total).toBe(1)
      expect(result.rows).toEqual(visibleRows)
      expect(whereClauses).toHaveLength(2)
      expect(mockAnd).toHaveBeenCalledTimes(1)
      expect(mockInArray).toHaveBeenCalledWith(entries.status, ['published', 'scheduled'])
      expect(mockIsNull).toHaveBeenCalledWith(entries.publishAt)
      expect(mockLte).toHaveBeenCalledWith(entries.publishAt, now)
      expect(mockIsNull).toHaveBeenCalledWith(entries.unpublishAt)
      expect(mockGt).toHaveBeenCalledWith(entries.unpublishAt, now)
      expect(mockOr).toHaveBeenCalledTimes(2)
      expect(mockOr).toHaveBeenCalledWith(expect.objectContaining({ type: 'isNull', value: entries.publishAt }), expect.objectContaining({ type: 'lte', left: entries.publishAt, right: now }))
      expect(mockOr).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'isNull', value: entries.unpublishAt }),
        expect.objectContaining({ type: 'gt', left: entries.unpublishAt, right: now })
      )
      expect(whereClauses[0]).toBeDefined()
    })

    it('injects caller-provided conditions into the visibility query', async () => {
      const whereClauses: unknown[] = []
      const mockDb = createChainableDb({
        selectResults: [[{ count: 0 }], []],
        onWhere: (condition) => {
          whereClauses.push(condition)
        },
      })
      const extraConditions = [{ type: 'sql-condition', value: 'dummy' }]

      await entriesRepository.findVisibleByCollection(mockDb as unknown as Database, {
        collectionId: 'c1',
        extraConditions: extraConditions as unknown as SQL[],
      })

      expect(whereClauses).toHaveLength(2)
      expect(whereClauses[0]).toBeDefined()
      expect(whereClauses[1]).toBeDefined()
    })
  })

  describe('findById', () => {
    it('returns entry when found', async () => {
      const row = makeEntryRow({ id: 'e1' })
      const mockDb = createChainableDb({ selectResults: [[{ entry: row }]] })

      const result = await entriesRepository.findById(mockDb as unknown as Database, 'e1')
      expect(result).toEqual(row)
    })

    it('returns undefined when entry not found', async () => {
      const mockDb = createChainableDb({ selectResults: [[]] })

      const result = await entriesRepository.findById(mockDb as unknown as Database, 'nonexistent')
      expect(result).toBeUndefined()
    })
  })

  describe('findByCollectionAndSlug', () => {
    it('returns entry matching collection and slug', async () => {
      const row = makeEntryRow({ collectionId: 'c1', slug: 'hello-world' })
      const mockDb = createChainableDb({ selectResults: [[{ entry: row }]] })

      const result = await entriesRepository.findByCollectionAndSlug(
        mockDb as unknown as Database,
        'c1',
        'hello-world'
      )
      expect(result).toEqual(row)
    })

    it('returns undefined when no match', async () => {
      const mockDb = createChainableDb({ selectResults: [[]] })

      const result = await entriesRepository.findByCollectionAndSlug(
        mockDb as unknown as Database,
        'c1',
        'nonexistent'
      )
      expect(result).toBeUndefined()
    })
  })

  describe('create', () => {
    it('inserts and returns a new entry row', async () => {
      const row = makeEntryRow({ id: 'e1' })
      const mockDb = createChainableDb({ returningResult: [row] })

      const result = await entriesRepository.create(mockDb as unknown as Database, {
        id: 'e1',
        collectionId: 'c1',
        slug: 'test',
        status: 'draft',
        data: { title: 'Test' },
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      })

      expect(result).toEqual(row)
    })
  })

  describe('update', () => {
    it('updates and returns entry row', async () => {
      const updated = makeEntryRow({ id: 'e1', status: 'published' })
      const mockDb = createChainableDb({ returningResult: [updated] })

      const result = await entriesRepository.update(mockDb as unknown as Database, 'e1', {
        status: 'published',
      })
      expect(result).toEqual(updated)
    })

    it('returns undefined when entry not found', async () => {
      const mockDb = createChainableDb({ returningResult: [] })

      const result = await entriesRepository.update(mockDb as unknown as Database, 'nonexistent', {
        status: 'published',
      })
      expect(result).toBeUndefined()
    })
  })

  describe('deleteById', () => {
    it('returns true when entry is deleted', async () => {
      const mockDb = createChainableDb({ returningResult: [{ id: 'e1' }] })

      const result = await entriesRepository.deleteById(mockDb as unknown as Database, 'e1')
      expect(result).toBe(true)
    })

    it('returns false when entry not found', async () => {
      const mockDb = createChainableDb({ returningResult: [] })

      const result = await entriesRepository.deleteById(
        mockDb as unknown as Database,
        'nonexistent'
      )
      expect(result).toBe(false)
    })
  })

  describe('createVersion', () => {
    it('creates a version snapshot and returns it', async () => {
      const versionRow = {
        id: 'v1',
        entryId: 'e1',
        version: 1,
        data: { title: 'Test' },
        createdBy: 'user1',
        createdAt: '2024-01-01T00:00:00.000Z',
      }
      const mockDb = createChainableDb({ returningResult: [versionRow] })

      const result = await entriesRepository.createVersion(
        mockDb as unknown as Database,
        versionRow
      )
      expect(result).toEqual(versionRow)
    })
  })

  describe('findVersions', () => {
    it('returns version history for an entry', async () => {
      const versions = [
        { id: 'v2', entryId: 'e1', version: 2, data: {}, createdBy: null, createdAt: '' },
        { id: 'v1', entryId: 'e1', version: 1, data: {}, createdBy: null, createdAt: '' },
      ]
      const mockDb = createChainableDb({ selectResults: [versions] })

      const result = await entriesRepository.findVersions(mockDb as unknown as Database, 'e1')
      expect(result).toEqual(versions)
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function makeEntryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'test-entry-id',
    collectionId: 'test-collection-id',
    slug: 'test-entry',
    status: 'draft',
    data: { title: 'Test Entry' },
    version: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function createChainableDb(opts: {
  selectResults?: unknown[][]
  returningResult?: unknown[]
  onWhere?: (condition: unknown) => void
}) {
  const selectResults = opts.selectResults ?? [[]]
  const returningResult = opts.returningResult ?? []
  let selectCallIndex = 0

  const makeSelectChain = () => {
    const currentResult = selectResults[selectCallIndex] ?? []
    selectCallIndex++

    const chainBase = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
    }
    const chain = Object.assign(Promise.resolve(currentResult), chainBase)
    chain.where = vi.fn().mockImplementation((condition) => {
      opts.onWhere?.(condition)
      return chain
    })
    return chain
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
