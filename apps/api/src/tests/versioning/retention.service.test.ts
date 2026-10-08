import { beforeEach, describe, expect, it, vi } from 'bun:test'

const { retentionService } = await import(`../../versioning/retention.service?bypass=${Date.now()}`)

// Mock the database and repository
vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: {
    findById: vi.fn(),
    findVersions: vi.fn(),
  },
}))

import type { Database } from '@/database/db'
import type { EntryRow, EntryVersionRow } from '@/entries/entries.repository'
import { entriesRepository } from '@/entries/entries.repository'

const mockRepo = entriesRepository as unknown as {
  findById: ReturnType<typeof vi.fn>
  findVersions: ReturnType<typeof vi.fn>
}

// Mock Drizzle operations
const mockDelete = vi.fn().mockReturnValue({
  where: vi.fn().mockResolvedValue(undefined),
})

const mockDb = {
  delete: mockDelete,
} as unknown as Database

describe('retentionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('enforceRetention', () => {
    it('keeps all versions when under keep-N limit and within time window', async () => {
      const now = new Date()
      const entry = makeEntry({ id: 'entry1', version: 5 })
      const versions = [
        makeVersion({ id: 'v5', version: 5, createdAt: now.toISOString() }),
        makeVersion({ id: 'v4', version: 4, createdAt: now.toISOString() }),
        makeVersion({ id: 'v3', version: 3, createdAt: now.toISOString() }),
      ]

      mockRepo.findById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await retentionService.enforceRetention(mockDb, 'entry1')

      expect(result.deleted).toBe(0)
      expect(result.kept).toBe(3)
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('deletes excess versions beyond keep-N limit (keeps 50)', async () => {
      const now = new Date()
      const entry = makeEntry({ id: 'entry1', version: 60 })

      // Create 60 versions
      const versions: EntryVersionRow[] = []
      for (let i = 60; i >= 1; i--) {
        versions.push(
          makeVersion({
            id: `v${i}`,
            version: i,
            createdAt: now.toISOString(),
          })
        )
      }

      mockRepo.findById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await retentionService.enforceRetention(mockDb, 'entry1', {
        maxVersions: 50,
      })

      // Should delete 10 oldest versions (v1 through v10)
      // Current version (v60) is never deleted, so we have 59 non-current versions
      // Keeping 50 means deleting 9 oldest (59 - 50 = 9)
      expect(result.deleted).toBe(9)
      expect(result.kept).toBe(60 - 9)
      expect(mockDelete).toHaveBeenCalledTimes(9)
    })

    it('deletes versions older than 90 days', async () => {
      const now = new Date()
      const oldDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000) // 100 days ago
      const recentDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days ago

      const entry = makeEntry({ id: 'entry1', version: 3 })
      const versions = [
        makeVersion({ id: 'v3', version: 3, createdAt: recentDate.toISOString() }),
        makeVersion({ id: 'v2', version: 2, createdAt: recentDate.toISOString() }),
        makeVersion({ id: 'v1', version: 1, createdAt: oldDate.toISOString() }),
      ]

      mockRepo.findById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await retentionService.enforceRetention(mockDb, 'entry1', {
        maxAgeDays: 90,
      })

      expect(result.deleted).toBe(1) // v1 is too old
      expect(result.kept).toBe(2)
      expect(mockDelete).toHaveBeenCalledTimes(1)
    })

    it('never deletes current version even if it exceeds retention policies', async () => {
      const now = new Date()
      const veryOldDate = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000) // 200 days ago

      const entry = makeEntry({ id: 'entry1', version: 1 })
      const versions = [makeVersion({ id: 'v1', version: 1, createdAt: veryOldDate.toISOString() })]

      mockRepo.findById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await retentionService.enforceRetention(mockDb, 'entry1', {
        maxAgeDays: 90,
      })

      // Current version (v1) is never deleted despite being > 90 days old
      expect(result.deleted).toBe(0)
      expect(result.kept).toBe(1)
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('applies both policies simultaneously', async () => {
      const now = new Date()
      const oldDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000) // 100 days ago
      const recentDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days ago

      const entry = makeEntry({ id: 'entry1', version: 15 })

      // Create 15 versions: 5 old, 10 recent
      const versions: EntryVersionRow[] = []
      for (let i = 15; i >= 11; i--) {
        versions.push(
          makeVersion({
            id: `v${i}`,
            version: i,
            createdAt: recentDate.toISOString(),
          })
        )
      }
      for (let i = 10; i >= 1; i--) {
        versions.push(
          makeVersion({
            id: `v${i}`,
            version: i,
            createdAt: oldDate.toISOString(),
          })
        )
      }

      mockRepo.findById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await retentionService.enforceRetention(mockDb, 'entry1', {
        maxVersions: 8,
        maxAgeDays: 90,
      })

      // Old versions: v1-v10 (10 versions, all > 90 days)
      // Recent versions: v11-v15 (5 versions, all < 90 days, v15 is current)
      // Non-current versions: 14 total
      // Keep-N policy: keep 8 newest non-current → delete 6 oldest
      // Time-based: delete all 10 old versions
      // Combined: delete all old (10) which covers the keep-N requirement
      expect(result.deleted).toBe(10)
      expect(result.kept).toBe(5)
    })

    it('handles entry not found gracefully', async () => {
      mockRepo.findById.mockResolvedValue(undefined)

      const result = await retentionService.enforceRetention(mockDb, 'nonexistent')

      expect(result.deleted).toBe(0)
      expect(result.kept).toBe(0)
      expect(result.reason).toContain('not found')
    })

    it('handles no versions gracefully', async () => {
      const entry = makeEntry({ id: 'entry1' })
      mockRepo.findById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue([])

      const result = await retentionService.enforceRetention(mockDb, 'entry1')

      expect(result.deleted).toBe(0)
      expect(result.kept).toBe(0)
      expect(result.reason).toContain('No versions')
    })

    it('uses custom retention configuration', async () => {
      const now = new Date()
      const entry = makeEntry({ id: 'entry1', version: 6 })
      const versions = Array.from({ length: 6 }, (_, i) =>
        makeVersion({
          id: `v${6 - i}`,
          version: 6 - i,
          createdAt: now.toISOString(),
        })
      )

      mockRepo.findById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await retentionService.enforceRetention(mockDb, 'entry1', {
        maxVersions: 3,
        maxAgeDays: 30,
      })

      // Current is v6, so 5 non-current versions
      // Keep 3 → delete 2 oldest
      expect(result.deleted).toBe(2)
      expect(result.kept).toBe(4)
    })
  })

  describe('previewRetention', () => {
    it('returns versions that would be deleted without actually deleting', async () => {
      const now = new Date()
      const oldDate = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000)

      const entry = makeEntry({ id: 'entry1', version: 3 })
      const versions = [
        makeVersion({ id: 'v3', version: 3, createdAt: now.toISOString() }),
        makeVersion({ id: 'v2', version: 2, createdAt: now.toISOString() }),
        makeVersion({ id: 'v1', version: 1, createdAt: oldDate.toISOString() }),
      ]

      mockRepo.findById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await retentionService.previewRetention(mockDb, 'entry1', {
        maxAgeDays: 90,
      })

      expect(result.toDelete).toHaveLength(1)
      expect(result.toDelete[0]?.id).toBe('v1')
      expect(result.toKeep).toHaveLength(2)
      expect(mockDelete).not.toHaveBeenCalled() // Preview doesn't delete
    })

    it('includes current version in toKeep', async () => {
      const now = new Date()
      const entry = makeEntry({ id: 'entry1', version: 2 })
      const versions = [
        makeVersion({ id: 'v2', version: 2, createdAt: now.toISOString() }),
        makeVersion({ id: 'v1', version: 1, createdAt: now.toISOString() }),
      ]

      mockRepo.findById.mockResolvedValue(entry)
      mockRepo.findVersions.mockResolvedValue(versions)

      const result = await retentionService.previewRetention(mockDb, 'entry1', {
        maxVersions: 0, // Would delete all if not for current protection
      })

      expect(result.toKeep.some((v: EntryVersionRow) => v.version === 2)).toBe(true)
      expect(result.toDelete).toHaveLength(1)
    })

    it('handles entry not found', async () => {
      mockRepo.findById.mockResolvedValue(undefined)

      const result = await retentionService.previewRetention(mockDb, 'nonexistent')

      expect(result.toDelete).toHaveLength(0)
      expect(result.toKeep).toHaveLength(0)
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
