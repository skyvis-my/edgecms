import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'

const { collectionsRepository } = await import(
  `../../collections/collections.repository?bypass=${Date.now()}`
)

// Since Drizzle compiles queries to SQL and calls D1 under the hood,
// we mock the entire repository module at the service level.
// For repository tests, we verify the functions exist and handle return types.
// The actual SQL is tested by Drizzle internals; we verify the repository API contract.

vi.mock('@/database/db', () => ({
  createDb: vi.fn(),
}))

describe('collectionsRepository', () => {
  let _db: Database

  beforeEach(() => {
    vi.clearAllMocks()
    // Create a mock database object with chainable query builder methods
    _db = createMockDrizzleDb()
  })

  describe('findAll', () => {
    it('returns an array of collection rows', async () => {
      const mockRows = [
        makeCollectionRow({ id: 'c1', name: 'Blog Posts', slug: 'blog-posts' }),
        makeCollectionRow({ id: 'c2', name: 'Products', slug: 'products' }),
      ]

      const mockDb = createChainableDb({
        allResult: mockRows,
      })

      const result = await collectionsRepository.findAll(mockDb as unknown as Database)
      expect(result).toEqual(mockRows)
    })

    it('returns an empty array when no collections exist', async () => {
      const mockDb = createChainableDb({ allResult: [] })

      const result = await collectionsRepository.findAll(mockDb as unknown as Database)
      expect(result).toEqual([])
    })
  })

  describe('findById', () => {
    it('returns a collection when found', async () => {
      const mockRow = makeCollectionRow({ id: 'c1', name: 'Blog' })
      const mockDb = createChainableDb({ selectResult: [mockRow] })

      const result = await collectionsRepository.findById(mockDb as unknown as Database, 'c1')
      expect(result).toEqual(mockRow)
    })

    it('returns undefined when collection not found', async () => {
      const mockDb = createChainableDb({ selectResult: [] })

      const result = await collectionsRepository.findById(
        mockDb as unknown as Database,
        'nonexistent'
      )
      expect(result).toBeUndefined()
    })
  })

  describe('findBySlug', () => {
    it('returns a collection when found by slug', async () => {
      const mockRow = makeCollectionRow({ slug: 'blog-posts' })
      const mockDb = createChainableDb({ selectResult: [mockRow] })

      const result = await collectionsRepository.findBySlug(
        mockDb as unknown as Database,
        'blog-posts'
      )
      expect(result).toEqual(mockRow)
    })

    it('returns undefined when slug not found', async () => {
      const mockDb = createChainableDb({ selectResult: [] })

      const result = await collectionsRepository.findBySlug(
        mockDb as unknown as Database,
        'nonexistent'
      )
      expect(result).toBeUndefined()
    })
  })

  describe('create', () => {
    it('inserts a new collection and returns the row', async () => {
      const input = {
        id: 'c1',
        name: 'Blog Posts',
        slug: 'blog-posts',
        singleton: false,
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
        defaultLocale: 'en',
        supportedLocales: ['en'],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }

      const mockRow = makeCollectionRow(input)
      const mockDb = createChainableDb({ returningResult: [mockRow] })

      const result = await collectionsRepository.create(mockDb as unknown as Database, input)
      expect(result).toEqual(mockRow)
    })
  })

  describe('update', () => {
    it('updates and returns the collection row', async () => {
      const updated = makeCollectionRow({
        id: 'c1',
        name: 'Updated Blog',
        updatedAt: '2024-01-02T00:00:00.000Z',
      })
      const mockDb = createChainableDb({ returningResult: [updated] })

      const result = await collectionsRepository.update(mockDb as unknown as Database, 'c1', {
        name: 'Updated Blog',
      })
      expect(result).toEqual(updated)
    })

    it('returns undefined when collection not found', async () => {
      const mockDb = createChainableDb({ returningResult: [] })

      const result = await collectionsRepository.update(
        mockDb as unknown as Database,
        'nonexistent',
        { name: 'X' }
      )
      expect(result).toBeUndefined()
    })
  })

  describe('deleteById', () => {
    it('returns true when a row is deleted', async () => {
      const mockDb = createChainableDb({ returningResult: [{ id: 'c1' }] })

      const result = await collectionsRepository.deleteById(mockDb as unknown as Database, 'c1')
      expect(result).toBe(true)
    })

    it('returns false when no row is deleted', async () => {
      const mockDb = createChainableDb({ returningResult: [] })

      const result = await collectionsRepository.deleteById(
        mockDb as unknown as Database,
        'nonexistent'
      )
      expect(result).toBe(false)
    })
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

function makeCollectionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'test-id',
    name: 'Test Collection',
    slug: 'test-collection',
    singleton: false,
    fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
    defaultLocale: 'en',
    supportedLocales: ['en'],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * Creates a mock Drizzle-like DB with chainable query builders.
 * This mock supports the common patterns used in repositories:
 *   db.select().from(table).where(cond).limit(n) -> Promise<rows>
 *   db.insert(table).values(data).returning() -> Promise<rows>
 *   db.update(table).set(data).where(cond).returning() -> Promise<rows>
 *   db.delete(table).where(cond).returning(opts) -> Promise<rows>
 *   db.select().from(table).all() -> Promise<rows>
 */
function createChainableDb(opts: {
  selectResult?: unknown[]
  allResult?: unknown[]
  returningResult?: unknown[]
}) {
  const selectResult = opts.selectResult ?? []
  const allResult = opts.allResult ?? []
  const returningResult = opts.returningResult ?? []

  // Select chain resolves as a thenable (Promise-like) using Object.assign
  // to avoid the noThenProperty lint rule.
  const selectChainBase = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue(allResult),
  }
  const selectChain = Object.assign(Promise.resolve(selectResult), selectChainBase)

  // Insert/Update/Delete chain
  const returningPromise = Object.assign(Promise.resolve(returningResult), {})
  const mutationChain = {
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue(returningPromise),
  }

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(mutationChain),
    update: vi.fn().mockReturnValue(mutationChain),
    delete: vi.fn().mockReturnValue(mutationChain),
  }
}

function createMockDrizzleDb() {
  return createChainableDb({}) as unknown as Database
}
