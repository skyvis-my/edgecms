import { afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import type { Database } from '@/database/db'

// Mock the entries repository before importing
const mockEntriesRepository = {
  findById: mock(),
  findVersions: mock(),
  createVersion: mock(),
  update: mock(),
}

mock.module('../../entries/entries.repository', () => ({
  entriesRepository: mockEntriesRepository,
}))

const { versioningRepository } = await import(
  `../../versioning/versioning.repository?bypass=${Date.now()}`
)

describe('versioningRepository', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // findEntryById
  // ==========================================================================
  describe('findEntryById', () => {
    it('delegates to entriesRepository.findById', async () => {
      const entry = {
        id: 'entry-1',
        collectionId: 'c1',
        slug: 'test',
        status: 'draft',
        data: { title: 'Test' },
        version: 1,
      }
      mockEntriesRepository.findById.mockResolvedValue(entry)

      const result = await versioningRepository.findEntryById(db, 'entry-1')

      expect(result).toEqual(entry)
      expect(mockEntriesRepository.findById).toHaveBeenCalledWith(db, 'entry-1')
    })

    it('returns undefined when entry does not exist', async () => {
      mockEntriesRepository.findById.mockResolvedValue(undefined)

      const result = await versioningRepository.findEntryById(db, 'nonexistent')

      expect(result).toBeUndefined()
    })
  })

  // ==========================================================================
  // findVersions
  // ==========================================================================
  describe('findVersions', () => {
    it('delegates to entriesRepository.findVersions', async () => {
      const versions = [
        { id: 'v3', entryId: 'entry-1', version: 3, data: { title: 'V3' }, createdAt: '2024-03-01' },
        { id: 'v2', entryId: 'entry-1', version: 2, data: { title: 'V2' }, createdAt: '2024-02-01' },
        { id: 'v1', entryId: 'entry-1', version: 1, data: { title: 'V1' }, createdAt: '2024-01-01' },
      ]
      mockEntriesRepository.findVersions.mockResolvedValue(versions)

      const result = await versioningRepository.findVersions(db, 'entry-1')

      expect(result).toEqual(versions)
      expect(result).toHaveLength(3)
      expect(mockEntriesRepository.findVersions).toHaveBeenCalledWith(db, 'entry-1')
    })

    it('returns empty array when no versions exist', async () => {
      mockEntriesRepository.findVersions.mockResolvedValue([])

      const result = await versioningRepository.findVersions(db, 'entry-1')

      expect(result).toEqual([])
    })
  })

  // ==========================================================================
  // createVersion
  // ==========================================================================
  describe('createVersion', () => {
    it('delegates to entriesRepository.createVersion with data', async () => {
      const versionData = {
        id: 'v4',
        entryId: 'entry-1',
        version: 4,
        data: { title: 'New Version' },
        createdBy: 'user-1',
        createdAt: '2024-04-01T00:00:00Z',
      }
      mockEntriesRepository.createVersion.mockResolvedValue(versionData)

      const result = await versioningRepository.createVersion(db, versionData)

      expect(result).toEqual(versionData)
      expect(mockEntriesRepository.createVersion).toHaveBeenCalledWith(db, versionData)
    })

    it('passes version data with all required fields', async () => {
      const data = {
        id: 'v1',
        entryId: 'entry-1',
        version: 1,
        data: { title: 'First' },
        createdBy: null,
        createdAt: '2024-01-01T00:00:00Z',
      }
      mockEntriesRepository.createVersion.mockResolvedValue(data)

      await versioningRepository.createVersion(db, data)

      expect(mockEntriesRepository.createVersion).toHaveBeenCalledWith(db, data)
    })
  })

  // ==========================================================================
  // updateEntry
  // ==========================================================================
  describe('updateEntry', () => {
    it('delegates to entriesRepository.update', async () => {
      const updatedEntry = {
        id: 'entry-1',
        version: 4,
        data: { title: 'Updated' },
        updatedAt: '2024-04-01T00:00:00Z',
      }
      mockEntriesRepository.update.mockResolvedValue(updatedEntry)

      const result = await versioningRepository.updateEntry(db, 'entry-1', {
        data: { title: 'Updated' },
        version: 4,
      })

      expect(result).toEqual(updatedEntry)
      expect(mockEntriesRepository.update).toHaveBeenCalledWith(db, 'entry-1', {
        data: { title: 'Updated' },
        version: 4,
      })
    })

    it('returns undefined when update finds no matching entry', async () => {
      mockEntriesRepository.update.mockResolvedValue(undefined)

      const result = await versioningRepository.updateEntry(db, 'nonexistent', {
        data: { title: 'nope' },
        version: 1,
      })

      expect(result).toBeUndefined()
    })

    it('passes the correct entryId to the underlying repository', async () => {
      mockEntriesRepository.update.mockResolvedValue({})

      await versioningRepository.updateEntry(db, 'my-entry-id', {
        data: { title: 'Rollback' },
        version: 5,
      })

      expect(mockEntriesRepository.update).toHaveBeenCalledWith(
        db,
        'my-entry-id',
        expect.objectContaining({ version: 5 })
      )
    })
  })
})
