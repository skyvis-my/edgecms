import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'

// Mock the repository modules before importing the service
mock.module('../../versioning/versioning.repository', () => ({
  versioningRepository: {
    findEntryById: mock(),
    findVersions: mock(),
    createVersion: mock(),
    updateEntry: mock(),
  },
}))

mock.module('../../commands/commands.repository', () => ({
  commandsRepository: {
    insertChangeLogEntries: mock(),
  },
}))

const { versioningService } = await import(
  `../../versioning/versioning.service?bypass=${Date.now()}`
)

import type { Database } from '@/database/db'
import type { EntryRow, EntryVersionRow } from '@/entries/entries.repository'
// Import after mocking
import { versioningRepository } from '../../versioning/versioning.repository'
import { commandsRepository } from '../../commands/commands.repository'

const mockRepo = versioningRepository as unknown as {
  findEntryById: ReturnType<typeof mock>
  findVersions: ReturnType<typeof mock>
  createVersion: ReturnType<typeof mock>
  updateEntry: ReturnType<typeof mock>
}

const mockCommandsRepo = commandsRepository as unknown as {
  insertChangeLogEntries: ReturnType<typeof mock>
}

describe('versioningService', () => {
  const db = {} as Database

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

    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'mock-uuid' as `${string}-${string}-${string}-${string}-${string}`
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('listVersions', () => {
    it('returns paginated versions for an entry', async () => {
      const entry = makeEntry({ id: 'entry1', version: 3 })
      const versions = [
        makeVersion({ id: 'v3', entryId: 'entry1', version: 3 }),
        makeVersion({ id: 'v2', entryId: 'entry1', version: 2 }),
        makeVersion({ id: 'v1', entryId: 'entry1', version: 1 }),
      ]

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await versioningService.listVersions(db, 'entry1', { page: 1, limit: 2 })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.versions).toHaveLength(2)
        expect(result.data.versions[0]?.id).toBe('v3')
        expect(result.data.versions[1]?.id).toBe('v2')
        expect(result.data.total).toBe(3)
        expect(result.data.page).toBe(1)
        expect(result.data.perPage).toBe(2)
      }
    })

    it('returns second page of versions', async () => {
      const entry = makeEntry({ id: 'entry1' })
      const versions = [
        makeVersion({ id: 'v3', version: 3 }),
        makeVersion({ id: 'v2', version: 2 }),
        makeVersion({ id: 'v1', version: 1 }),
      ]

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await versioningService.listVersions(db, 'entry1', { page: 2, limit: 2 })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.versions).toHaveLength(1)
        expect(result.data.versions[0]?.id).toBe('v1')
        expect(result.data.page).toBe(2)
      }
    })

    it('returns NOT_FOUND when entry does not exist', async () => {
      mockRepo.findEntryById.mockResolvedValue(undefined)

      const result = await versioningService.listVersions(db, 'nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('uses default pagination when not specified', async () => {
      const entry = makeEntry({ id: 'entry1' })
      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([])

      const result = await versioningService.listVersions(db, 'entry1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.page).toBe(1)
        expect(result.data.perPage).toBe(20)
      }
    })

    it('returns latestDiff computed from the two newest versions', async () => {
      const entry = makeEntry({ id: 'entry1' })
      const versions = [
        makeVersion({ id: 'v2', version: 2, data: { title: 'New', status: 'published' } }),
        makeVersion({ id: 'v1', version: 1, data: { title: 'Old', status: 'draft' } }),
      ]
      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await versioningService.listVersions(db, 'entry1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(Array.isArray((result.data as { latestDiff?: unknown }).latestDiff)).toBe(true)
        expect((result.data as { latestDiff?: Array<{ field: string }> }).latestDiff?.[0]?.field).toBe(
          'title'
        )
      }
    })
  })

  describe('getVersion', () => {
    it('returns a single version by ID', async () => {
      const entry = makeEntry({ id: 'entry1' })
      const versions = [
        makeVersion({ id: 'v2', entryId: 'entry1', version: 2 }),
        makeVersion({ id: 'v1', entryId: 'entry1', version: 1 }),
      ]

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await versioningService.getVersion(db, 'entry1', 'v2')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('v2')
        expect(result.data.version).toBe(2)
      }
    })

    it('returns NOT_FOUND when entry does not exist', async () => {
      mockRepo.findEntryById.mockResolvedValue(undefined)

      const result = await versioningService.getVersion(db, 'nonexistent', 'v1')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('returns NOT_FOUND when version does not exist', async () => {
      const entry = makeEntry({ id: 'entry1' })
      const versions = [makeVersion({ id: 'v1', entryId: 'entry1' })]

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await versioningService.getVersion(db, 'entry1', 'nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toContain('Version')
      }
    })
  })

  describe('diffVersions', () => {
    it('computes field-level diff showing added fields', async () => {
      const entry = makeEntry({ id: 'entry1' })
      const v1 = makeVersion({ id: 'v1', data: { title: 'Hello' } })
      const v2 = makeVersion({ id: 'v2', data: { title: 'Hello', author: 'Alice' } })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([v2, v1])

      const result = await versioningService.diffVersions(db, 'entry1', 'v1', 'v2')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(1)
        expect(result.data[0]).toEqual({
          field: 'author',
          before: undefined,
          after: 'Alice',
          action: 'add',
        })
      }
    })

    it('computes field-level diff showing updated fields', async () => {
      const entry = makeEntry({ id: 'entry1' })
      const v1 = makeVersion({ id: 'v1', data: { title: 'Hello', count: 5 } })
      const v2 = makeVersion({ id: 'v2', data: { title: 'World', count: 10 } })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([v2, v1])

      const result = await versioningService.diffVersions(db, 'entry1', 'v1', 'v2')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(2)
        const titleDiff = result.data.find((d: { field: string }) => d.field === 'title')
        expect(titleDiff).toBeDefined()
        expect(titleDiff).toEqual({
          field: 'title',
          before: 'Hello',
          after: 'World',
          action: 'update',
        })
        const countDiff = result.data.find((d: { field: string }) => d.field === 'count')
        expect(countDiff).toBeDefined()
        expect(countDiff).toEqual({
          field: 'count',
          before: 5,
          after: 10,
          action: 'update',
        })
      }
    })

    it('computes field-level diff showing removed fields', async () => {
      const entry = makeEntry({ id: 'entry1' })
      const v1 = makeVersion({ id: 'v1', data: { title: 'Hello', author: 'Alice' } })
      const v2 = makeVersion({ id: 'v2', data: { title: 'Hello' } })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([v2, v1])

      const result = await versioningService.diffVersions(db, 'entry1', 'v1', 'v2')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(1)
        expect(result.data[0]).toEqual({
          field: 'author',
          before: 'Alice',
          after: undefined,
          action: 'remove',
        })
      }
    })

    it('returns empty diff when versions are identical', async () => {
      const entry = makeEntry({ id: 'entry1' })
      const v1 = makeVersion({ id: 'v1', data: { title: 'Hello' } })
      const v2 = makeVersion({ id: 'v2', data: { title: 'Hello' } })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([v2, v1])

      const result = await versioningService.diffVersions(db, 'entry1', 'v1', 'v2')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(0)
      }
    })

    it('handles complex nested object changes', async () => {
      const entry = makeEntry({ id: 'entry1' })
      const v1 = makeVersion({ id: 'v1', data: { meta: { author: 'Alice', tags: ['a'] } } })
      const v2 = makeVersion({ id: 'v2', data: { meta: { author: 'Bob', tags: ['a', 'b'] } } })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([v2, v1])

      const result = await versioningService.diffVersions(db, 'entry1', 'v1', 'v2')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(1)
        expect(result.data[0]?.field).toBe('meta')
        expect(result.data[0]?.action).toBe('update')
      }
    })
  })

  describe('rollback', () => {
    it('creates new version and updates entry with historical data', async () => {
      const entry = makeEntry({
        id: 'entry1',
        version: 3,
        data: { title: 'Current' },
      })
      const targetVersion = makeVersion({
        id: 'v1',
        entryId: 'entry1',
        version: 1,
        data: { title: 'Original' },
      })
      const newVersionRecord = makeVersion({
        id: 'mock-uuid',
        entryId: 'entry1',
        version: 4,
        data: { title: 'Original' },
      })
      const updatedEntry = makeEntry({
        id: 'entry1',
        version: 4,
        data: { title: 'Original' },
      })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([targetVersion])
      mockRepo.createVersion.mockResolvedValue(newVersionRecord)
      mockRepo.updateEntry.mockResolvedValue(updatedEntry)

      const result = await versioningService.rollback(db, 'entry1', 'v1', 'user123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.entry).toBeDefined()
        expect(result.data.entry?.version).toBe(4)
        expect(result.data.entry?.data).toEqual({ title: 'Original' })
        expect(result.data.newVersion.version).toBe(4)
        expect(mockRepo.createVersion).toHaveBeenCalledWith(
          db,
          expect.objectContaining({
            entryId: 'entry1',
            version: 4,
            data: { title: 'Original' },
            createdBy: 'user123',
          })
        )
        expect(mockRepo.updateEntry).toHaveBeenCalledWith(
          db,
          'entry1',
          expect.objectContaining({
            data: { title: 'Original' },
            version: 4,
          })
        )
      }
    })

    it('does not delete intermediate versions during rollback', async () => {
      const entry = makeEntry({ id: 'entry1', version: 5 })
      const targetVersion = makeVersion({ id: 'v2', version: 2 })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([targetVersion])
      mockRepo.createVersion.mockResolvedValue(makeVersion({}))
      mockRepo.updateEntry.mockResolvedValue(makeEntry({ version: 6 }))

      await versioningService.rollback(db, 'entry1', 'v2')

      // Verify no delete operations occurred (only create and update)
      expect(mockRepo.createVersion).toHaveBeenCalledTimes(1)
      expect(mockRepo.updateEntry).toHaveBeenCalledTimes(1)
    })

    it('returns NOT_FOUND when entry does not exist', async () => {
      mockRepo.findEntryById.mockResolvedValue(undefined)

      const result = await versioningService.rollback(db, 'nonexistent', 'v1')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('returns NOT_FOUND when version does not exist', async () => {
      const entry = makeEntry({ id: 'entry1' })
      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([])

      const result = await versioningService.rollback(db, 'entry1', 'nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('handles rollback failure gracefully', async () => {
      const entry = makeEntry({ id: 'entry1', version: 2 })
      const targetVersion = makeVersion({ id: 'v1', version: 1 })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([targetVersion])
      mockRepo.createVersion.mockResolvedValue(makeVersion({}))
      mockRepo.updateEntry.mockResolvedValue(undefined) // Update fails

      const result = await versioningService.rollback(db, 'entry1', 'v1')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('ROLLBACK_FAILED')
      }
    })

    // ========================================================================
    // Changelog entry tests
    // ========================================================================

    it('writes a changelog entry when an entry is rolled back', async () => {
      const entry = makeEntry({
        id: 'entry1',
        version: 3,
        data: { title: 'Current' },
      })
      const targetVersion = makeVersion({
        id: 'v1',
        entryId: 'entry1',
        version: 1,
        data: { title: 'Original' },
      })
      const newVersionRecord = makeVersion({
        id: 'mock-uuid',
        entryId: 'entry1',
        version: 4,
        data: { title: 'Original' },
      })
      const updatedEntry = makeEntry({
        id: 'entry1',
        version: 4,
        data: { title: 'Original' },
      })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([targetVersion])
      mockRepo.createVersion.mockResolvedValue(newVersionRecord)
      mockRepo.updateEntry.mockResolvedValue(updatedEntry)

      const result = await versioningService.rollback(db, 'entry1', 'v1', 'user123')

      expect(result.success).toBe(true)
      expect(mockCommandsRepo.insertChangeLogEntries).toHaveBeenCalledTimes(1)
      expect(mockCommandsRepo.insertChangeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          db,
          commandId: null,
          entries: [
            expect.objectContaining({
              entityType: 'entry',
              entityId: 'entry1',
              action: 'update',
            }),
          ],
          tenantScope: null,
        })
      )
    })

    it('includes _rollbackFromVersion in changelog payload', async () => {
      const entry = makeEntry({
        id: 'entry1',
        version: 3,
        data: { title: 'Current' },
      })
      const targetVersion = makeVersion({
        id: 'v1',
        entryId: 'entry1',
        version: 1,
        data: { title: 'Original' },
      })
      const newVersionRecord = makeVersion({
        id: 'mock-uuid',
        entryId: 'entry1',
        version: 4,
        data: { title: 'Original' },
      })
      const updatedEntry = makeEntry({
        id: 'entry1',
        version: 4,
        data: { title: 'Original' },
      })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([targetVersion])
      mockRepo.createVersion.mockResolvedValue(newVersionRecord)
      mockRepo.updateEntry.mockResolvedValue(updatedEntry)

      const result = await versioningService.rollback(db, 'entry1', 'v1', 'user123')

      expect(result.success).toBe(true)
      expect(mockCommandsRepo.insertChangeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: [
            expect.objectContaining({
              changes: expect.objectContaining({
                _rollbackFromVersion: 'v1',
              }),
            }),
          ],
        })
      )
    })

    it('writes a changelog entry with tenantScope when provided', async () => {
      const entry = makeEntry({
        id: 'entry1',
        version: 3,
        data: { title: 'Current' },
      })
      const targetVersion = makeVersion({
        id: 'v1',
        entryId: 'entry1',
        version: 1,
        data: { title: 'Original' },
      })
      const newVersionRecord = makeVersion({
        id: 'mock-uuid',
        entryId: 'entry1',
        version: 4,
        data: { title: 'Original' },
      })
      const updatedEntry = makeEntry({
        id: 'entry1',
        version: 4,
        data: { title: 'Original' },
      })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([targetVersion])
      mockRepo.createVersion.mockResolvedValue(newVersionRecord)
      mockRepo.updateEntry.mockResolvedValue(updatedEntry)

      const result = await versioningService.rollback(
        db,
        'entry1',
        'v1',
        'user123',
        'tenant-abc'
      )

      expect(result.success).toBe(true)
      expect(mockCommandsRepo.insertChangeLogEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantScope: 'tenant-abc',
        })
      )
    })

    it('does not write a changelog entry when rollback fails', async () => {
      const entry = makeEntry({ id: 'entry1', version: 2 })
      const targetVersion = makeVersion({ id: 'v1', version: 1 })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([targetVersion])
      mockRepo.createVersion.mockResolvedValue(makeVersion({}))
      mockRepo.updateEntry.mockResolvedValue(undefined) // Update fails

      const result = await versioningService.rollback(db, 'entry1', 'v1')

      expect(result.success).toBe(false)
      expect(mockCommandsRepo.insertChangeLogEntries).not.toHaveBeenCalled()
    })

    it('does not fail the rollback when changelog write throws', async () => {
      const entry = makeEntry({
        id: 'entry1',
        version: 3,
        data: { title: 'Current' },
      })
      const targetVersion = makeVersion({
        id: 'v1',
        entryId: 'entry1',
        version: 1,
        data: { title: 'Original' },
      })
      const newVersionRecord = makeVersion({
        id: 'mock-uuid',
        entryId: 'entry1',
        version: 4,
        data: { title: 'Original' },
      })
      const updatedEntry = makeEntry({
        id: 'entry1',
        version: 4,
        data: { title: 'Original' },
      })

      mockRepo.findEntryById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([targetVersion])
      mockRepo.createVersion.mockResolvedValue(newVersionRecord)
      mockRepo.updateEntry.mockResolvedValue(updatedEntry)
      mockCommandsRepo.insertChangeLogEntries.mockRejectedValue(new Error('DB write failed'))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await versioningService.rollback(db, 'entry1', 'v1', 'user123')

      // Rollback should still succeed even though changelog failed
      expect(result.success).toBe(true)
      expect(consoleSpy).toHaveBeenCalledWith(
        'rollback_changelog_write_failed',
        expect.objectContaining({
          error: 'DB write failed',
        })
      )

      consoleSpy.mockRestore()
    })
  })
})

// ============================================================================
// Helpers
// ============================================================================

function makeEntry(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: 'entry-id',
    collectionId: 'collection-id',
    slug: 'test-entry',
    status: 'draft',
    data: { title: 'Test Entry' },
    version: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as EntryRow
}

function makeVersion(overrides: Partial<EntryVersionRow> = {}): EntryVersionRow {
  return {
    id: 'version-id',
    entryId: 'entry-id',
    version: 1,
    data: { title: 'Test' },
    createdBy: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as EntryVersionRow
}
