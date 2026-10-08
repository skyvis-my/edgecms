import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'

// Mock the repository modules before importing the service
mock.module('../../collections/collections.repository', () => ({
  collectionsRepository: {
    findAll: mock(),
    findById: mock(),
    findBySlug: mock(),
    findSlugsByPrefix: mock(),
    create: mock(),
    update: mock(),
    deleteById: mock(),
  },
}))

mock.module('../../commands/commands.repository', () => ({
  commandsRepository: {
    insertChangeLogEntries: mock(),
    insertProcessedCommand: mock(),
    insertAuditEntries: mock(),
  },
}))

const mockFindLatestSnapshot = mock()
const mockCreateSnapshot = mock()
mock.module('../../collections/schema-snapshots.repository', () => ({
  schemaSnapshotsRepository: {
    findLatestSnapshot: mockFindLatestSnapshot,
    createSnapshot: mockCreateSnapshot,
  },
}))

const { collectionsService } = await import(
  `../../collections/collections.service?bypass=${Date.now()}`
)

import type { Database } from '@/database/db'
// Import after mocking
import { collectionsRepository } from '../../collections/collections.repository'
import { commandsRepository } from '../../commands/commands.repository'

const mockRepo = collectionsRepository as unknown as {
  findAll: ReturnType<typeof mock>
  findById: ReturnType<typeof mock>
  findBySlug: ReturnType<typeof mock>
  findSlugsByPrefix: ReturnType<typeof mock>
  create: ReturnType<typeof mock>
  update: ReturnType<typeof mock>
  deleteById: ReturnType<typeof mock>
}

const mockCommandsRepo = commandsRepository as unknown as {
  insertChangeLogEntries: ReturnType<typeof mock>
}

describe('collectionsService', () => {
  let db: Database
  let mockDbSelectLimit: ReturnType<typeof mock>
  let mockDbInsertValues: ReturnType<typeof mock>

  beforeEach(() => {
    // Clear mocks
    Object.values(mockRepo).forEach((m) => {
      m.mockClear()
    })
    Object.values(mockCommandsRepo).forEach((m) => {
      m.mockClear()
    })

    // Default: changelog writes succeed
    mockCommandsRepo.insertChangeLogEntries.mockResolvedValue(undefined)
    mockRepo.findAll.mockResolvedValue([])

    // Default: schema snapshots mocks
    mockFindLatestSnapshot.mockReset()
    mockCreateSnapshot.mockReset()
    mockFindLatestSnapshot.mockResolvedValue(undefined)
    mockCreateSnapshot.mockResolvedValue(undefined)

    mockDbSelectLimit = mock().mockResolvedValue([])
    const mockDbSelectOrderBy = mock().mockReturnValue({
      limit: mockDbSelectLimit,
    })
    const mockDbSelectWhere = mock().mockReturnValue({
      orderBy: mockDbSelectOrderBy,
    })
    const mockDbSelectFrom = mock().mockReturnValue({
      where: mockDbSelectWhere,
    })
    const mockDbSelect = mock().mockReturnValue({
      from: mockDbSelectFrom,
    })

    mockDbInsertValues = mock().mockResolvedValue(undefined)
    const mockDbInsert = mock().mockReturnValue({
      values: mockDbInsertValues,
    })

    db = {
      select: mockDbSelect,
      insert: mockDbInsert,
    } as unknown as Database

    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'mock-uuid' as `${string}-${string}-${string}-${string}-${string}`
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('findAll', () => {
    it('returns all collections successfully', async () => {
      const rows = [makeRow({ id: 'c1' }), makeRow({ id: 'c2' })]
      mockRepo.findAll.mockResolvedValue(rows)

      const result = await collectionsService.findAll(db)
      expect(result).toEqual({ success: true, data: rows })
      expect(mockRepo.findAll).toHaveBeenCalledWith(db)
    })

    it('returns empty array when no collections exist', async () => {
      mockRepo.findAll.mockResolvedValue([])

      const result = await collectionsService.findAll(db)
      expect(result).toEqual({ success: true, data: [] })
    })
  })

  describe('findByIdOrSlug', () => {
    it('returns collection found by ID', async () => {
      const row = makeRow({ id: 'c1' })
      mockRepo.findById.mockResolvedValue(row)

      const result = await collectionsService.findByIdOrSlug(db, 'c1')
      expect(result).toEqual({ success: true, data: row })
    })

    it('falls back to slug lookup when ID not found', async () => {
      const row = makeRow({ slug: 'blog-posts' })
      mockRepo.findById.mockResolvedValue(undefined)
      mockRepo.findBySlug.mockResolvedValue(row)

      const result = await collectionsService.findByIdOrSlug(db, 'blog-posts')
      expect(result).toEqual({ success: true, data: row })
      expect(mockRepo.findById).toHaveBeenCalledWith(db, 'blog-posts')
      expect(mockRepo.findBySlug).toHaveBeenCalledWith(db, 'blog-posts')
    })

    it('returns NOT_FOUND when neither ID nor slug matches', async () => {
      mockRepo.findById.mockResolvedValue(undefined)
      mockRepo.findBySlug.mockResolvedValue(undefined)

      const result = await collectionsService.findByIdOrSlug(db, 'nonexistent')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  describe('create', () => {
    it('creates a collection with valid fields', async () => {
      mockRepo.findSlugsByPrefix.mockResolvedValue([])
      const created = makeRow({ id: 'mock-uuid', name: 'Blog Posts', slug: 'blog-posts' })
      mockRepo.create.mockResolvedValue(created)

      const result = await collectionsService.create(db, {
        name: 'Blog Posts',
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
      })

      expect(result).toEqual({ success: true, data: created })
      expect(mockRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          id: 'mock-uuid',
          name: 'Blog Posts',
          slug: 'blog-posts',
          singleton: false,
          defaultLocale: 'en',
          supportedLocales: ['en'],
        })
      )
    })

    it('preserves content modeling field semantics when creating collections', async () => {
      mockRepo.findSlugsByPrefix.mockResolvedValue([])
      mockRepo.create.mockResolvedValue(makeRow({ id: 'mock-uuid', slug: 'landing-pages' }))
      const fields = [
        {
          name: 'author',
          type: 'relation',
          required: true,
          localizable: false,
          options: { relationType: 'one-to-one', targetCollectionId: 'authors' },
        },
        {
          name: 'hero',
          type: 'media',
          required: false,
          localizable: false,
          options: { accept: ['image/*'], maxSizeBytes: 5242880 },
        },
        {
          name: 'blocks',
          type: 'array',
          required: false,
          localizable: true,
          options: { itemFields: [{ name: 'heading', type: 'text', required: true }] },
        },
      ]

      const result = await collectionsService.create(db, {
        name: 'Landing Pages',
        fields,
      })

      expect(result.success).toBe(true)
      expect(mockRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          fields,
        })
      )
    })

    it('auto-generates slug from name', async () => {
      mockRepo.findSlugsByPrefix.mockResolvedValue([])
      mockRepo.create.mockResolvedValue(makeRow({ slug: 'my-awesome-collection' }))

      await collectionsService.create(db, {
        name: 'My Awesome Collection!',
        fields: [],
      })

      expect(mockRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          slug: 'my-awesome-collection',
        })
      )
    })

    it('uses provided slug when creating a collection', async () => {
      mockRepo.findBySlug.mockResolvedValue(undefined)
      mockRepo.create.mockResolvedValue(makeRow({ slug: 'custom-events' }))

      await collectionsService.create(db, {
        name: 'Events Collection',
        slug: 'Custom Events',
        fields: [],
      })

      expect(mockRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          slug: 'custom-events',
        })
      )
    })

    it('appends suffix on slug conflict', async () => {
      mockRepo.findSlugsByPrefix.mockResolvedValue(['blog'])
      mockRepo.create.mockResolvedValue(makeRow({ slug: 'blog-1' }))

      await collectionsService.create(db, {
        name: 'Blog',
        fields: [],
      })

      expect(mockRepo.findSlugsByPrefix).toHaveBeenCalledTimes(1)
      expect(mockRepo.create).toHaveBeenCalledWith(db, expect.objectContaining({ slug: 'blog-1' }))
    })

    it('rejects when name produces empty slug', async () => {
      const result = await collectionsService.create(db, {
        name: '!!!',
        fields: [],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('valid slug')
      }
    })

    it('rejects when defaultLocale not in supportedLocales', async () => {
      const result = await collectionsService.create(db, {
        name: 'Blog',
        fields: [],
        defaultLocale: 'fr',
        supportedLocales: ['en', 'de'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('defaultLocale')
        expect(result.error.message).toContain('supportedLocales')
      }
    })

    it('rejects empty supportedLocales array', async () => {
      const result = await collectionsService.create(db, {
        name: 'Blog',
        fields: [],
        supportedLocales: [],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('supportedLocales')
      }
    })

    it('uses defaults for locale config when not provided', async () => {
      mockRepo.findSlugsByPrefix.mockResolvedValue([])
      mockRepo.create.mockResolvedValue(makeRow())

      await collectionsService.create(db, {
        name: 'Blog',
        fields: [],
      })

      expect(mockRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          defaultLocale: 'en',
          supportedLocales: ['en'],
        })
      )
    })
  })

  describe('update', () => {
    it('updates an existing collection', async () => {
      const existing = makeRow({ id: 'c1' })
      mockRepo.findById.mockResolvedValue(existing)
      const updated = makeRow({ id: 'c1', name: 'Updated' })
      mockRepo.update.mockResolvedValue(updated)

      const result = await collectionsService.update(db, 'c1', { name: 'Updated' })
      expect(result).toEqual({ success: true, data: updated })
    })

    it('returns NOT_FOUND when collection does not exist', async () => {
      mockRepo.findById.mockResolvedValue(undefined)

      const result = await collectionsService.update(db, 'nonexistent', { name: 'X' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('validates defaultLocale against supportedLocales on update', async () => {
      const existing = makeRow({
        id: 'c1',
        defaultLocale: 'en',
        supportedLocales: ['en', 'fr'],
      })
      mockRepo.findById.mockResolvedValue(existing)

      const result = await collectionsService.update(db, 'c1', {
        defaultLocale: 'de',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('defaultLocale')
      }
    })

    it('validates supportedLocales must be non-empty on update', async () => {
      const existing = makeRow({ id: 'c1' })
      mockRepo.findById.mockResolvedValue(existing)

      const result = await collectionsService.update(db, 'c1', {
        supportedLocales: [],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('allows updating supportedLocales if defaultLocale still included', async () => {
      const existing = makeRow({ id: 'c1', defaultLocale: 'en', supportedLocales: ['en'] })
      mockRepo.findById.mockResolvedValue(existing)
      mockRepo.update.mockResolvedValue(makeRow({ id: 'c1', supportedLocales: ['en', 'fr'] }))

      const result = await collectionsService.update(db, 'c1', {
        supportedLocales: ['en', 'fr'],
      })

      expect(result.success).toBe(true)
    })
  })

  describe('deleteById', () => {
    it('deletes an existing collection', async () => {
      mockRepo.deleteById.mockResolvedValue(true)

      const result = await collectionsService.deleteById(db, 'c1')
      expect(result).toEqual({ success: true, data: { id: 'c1' } })
    })

    it('returns NOT_FOUND when collection does not exist', async () => {
      mockRepo.deleteById.mockResolvedValue(false)

      const result = await collectionsService.deleteById(db, 'nonexistent')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  // ==========================================================================
  // Changelog entry tests
  // ==========================================================================

  describe('changelog entries', () => {
    it('writes a changelog entry when a collection is created', async () => {
      mockRepo.findSlugsByPrefix.mockResolvedValue([])
      const created = makeRow({ id: 'mock-uuid', name: 'Blog Posts', slug: 'blog-posts' })
      mockRepo.create.mockResolvedValue(created)

      const result = await collectionsService.create(db, {
        name: 'Blog Posts',
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
      })

      expect(result.success).toBe(true)
      expect(mockCommandsRepo.insertChangeLogEntries).toHaveBeenCalledTimes(1)
      expect(mockCommandsRepo.insertChangeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          db,
          commandId: null,
          entries: [
            expect.objectContaining({
              entityType: 'collection',
              entityId: 'mock-uuid',
              action: 'create',
            }),
          ],
          tenantScope: null,
        })
      )
    })

    it('writes a changelog entry with tenantScope when creating a tenant-scoped collection', async () => {
      mockRepo.findSlugsByPrefix.mockResolvedValue([])
      const created = makeRow({ id: 'mock-uuid', name: 'Blog Posts', slug: 'blog-posts' })
      mockRepo.create.mockResolvedValue(created)

      const result = await collectionsService.create(
        db,
        {
          name: 'Blog Posts',
          fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
        },
        'tenant-123'
      )

      expect(result.success).toBe(true)
      expect(mockCommandsRepo.insertChangeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantScope: 'tenant-123',
        })
      )
    })

    it('writes a changelog entry when a collection is updated', async () => {
      const existing = makeRow({ id: 'c1' })
      mockRepo.findById.mockResolvedValue(existing)
      const updated = makeRow({ id: 'c1', name: 'Updated Blog' })
      mockRepo.update.mockResolvedValue(updated)

      const result = await collectionsService.update(db, 'c1', { name: 'Updated Blog' })

      expect(result.success).toBe(true)
      expect(mockCommandsRepo.insertChangeLogEntries).toHaveBeenCalledTimes(1)
      expect(mockCommandsRepo.insertChangeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          db,
          commandId: null,
          entries: [
            expect.objectContaining({
              entityType: 'collection',
              entityId: 'c1',
              action: 'update',
            }),
          ],
          tenantScope: null,
        })
      )
    })

    it('writes a changelog entry when a collection is deleted', async () => {
      mockRepo.deleteById.mockResolvedValue(true)

      const result = await collectionsService.deleteById(db, 'c1')

      expect(result.success).toBe(true)
      expect(mockCommandsRepo.insertChangeLogEntries).toHaveBeenCalledTimes(1)
      expect(mockCommandsRepo.insertChangeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          db,
          commandId: null,
          entries: [
            expect.objectContaining({
              entityType: 'collection',
              entityId: 'c1',
              action: 'delete',
            }),
          ],
          tenantScope: null,
        })
      )
    })

    it('does not write a changelog entry when create fails validation', async () => {
      const result = await collectionsService.create(db, {
        name: '!!!',
        fields: [],
      })

      expect(result.success).toBe(false)
      expect(mockCommandsRepo.insertChangeLogEntries).not.toHaveBeenCalled()
    })

    it('does not write a changelog entry when update finds no collection', async () => {
      mockRepo.findById.mockResolvedValue(undefined)

      const result = await collectionsService.update(db, 'nonexistent', { name: 'X' })

      expect(result.success).toBe(false)
      expect(mockCommandsRepo.insertChangeLogEntries).not.toHaveBeenCalled()
    })

    it('does not write a changelog entry when delete finds no collection', async () => {
      mockRepo.deleteById.mockResolvedValue(false)

      const result = await collectionsService.deleteById(db, 'nonexistent')

      expect(result.success).toBe(false)
      expect(mockCommandsRepo.insertChangeLogEntries).not.toHaveBeenCalled()
    })

    it('does not fail the mutation when changelog write throws', async () => {
      mockRepo.findSlugsByPrefix.mockResolvedValue([])
      const created = makeRow({ id: 'mock-uuid', name: 'Blog Posts', slug: 'blog-posts' })
      mockRepo.create.mockResolvedValue(created)
      mockCommandsRepo.insertChangeLogEntries.mockRejectedValue(new Error('DB write failed'))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await collectionsService.create(db, {
        name: 'Blog Posts',
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
      })

      // Mutation should still succeed even though changelog failed
      expect(result.success).toBe(true)
      expect(consoleSpy).toHaveBeenCalledWith(
        'collection_changelog_write_failed',
        expect.objectContaining({
          error: 'DB write failed',
        })
      )

      consoleSpy.mockRestore()
    })
  })

  describe('schema snapshots', () => {
    it('writes a schema snapshot after collection create', async () => {
      mockRepo.findSlugsByPrefix.mockResolvedValue([])
      const created = makeRow({ id: 'mock-uuid', name: 'Blog Posts', slug: 'blog-posts' })
      mockRepo.create.mockResolvedValue(created)
      mockRepo.findAll.mockResolvedValue([created])

      const result = await collectionsService.create(db, {
        name: 'Blog Posts',
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
      })

      expect(result.success).toBe(true)
      expect(mockCreateSnapshot).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          tenantId: 'global',
          schemaVersion: 1,
          payload: expect.objectContaining({
            collections: [
              expect.objectContaining({
                id: 'mock-uuid',
                slug: 'blog-posts',
              }),
            ],
          }),
        })
      )
    })

    it('increments schema version for tenant-scoped snapshots', async () => {
      const existing = makeRow({ id: 'c1', tenantId: 'tenant-1' })
      mockRepo.findById.mockResolvedValue(existing)
      mockRepo.update.mockResolvedValue(makeRow({ id: 'c1', tenantId: 'tenant-1', name: 'Updated' }))
      mockRepo.findAll.mockResolvedValue([makeRow({ id: 'c1', tenantId: 'tenant-1', name: 'Updated' })])
      mockFindLatestSnapshot.mockResolvedValue({ schemaVersion: 4 })

      const result = await collectionsService.update(db, 'c1', { name: 'Updated' }, 'tenant-1')

      expect(result.success).toBe(true)
      expect(mockCreateSnapshot).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          tenantId: 'tenant-1',
          schemaVersion: 5,
        })
      )
    })

    it('does not fail the mutation when schema snapshot write throws', async () => {
      mockRepo.findSlugsByPrefix.mockResolvedValue([])
      mockRepo.create.mockResolvedValue(makeRow({ id: 'mock-uuid' }))
      mockRepo.findAll.mockResolvedValue([makeRow({ id: 'mock-uuid' })])
      mockCreateSnapshot.mockRejectedValue(new Error('snapshot insert failed'))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await collectionsService.create(db, {
        name: 'Blog Posts',
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
      })

      expect(result.success).toBe(true)
      expect(consoleSpy).toHaveBeenCalledWith(
        'schema_snapshot_write_failed',
        expect.objectContaining({
          error: 'snapshot insert failed',
        })
      )
      consoleSpy.mockRestore()
    })
  })
})

// ============================================================================
// Helpers
// ============================================================================

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
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
