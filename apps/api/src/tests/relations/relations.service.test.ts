import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { EntryRow } from '@/entries/entries.repository'
import type { RelationRow } from '../../relations/relations.repository'

const { relationsService } = await import(`../../relations/relations.service?bypass=${Date.now()}`)

vi.mock('../../relations/relations.repository', () => ({
  relationsRepository: {
    link: vi.fn(),
    unlink: vi.fn(),
    unlinkByEntries: vi.fn(),
    findBySourceEntry: vi.fn(),
    findByTargetEntry: vi.fn(),
    findBySourceEntryAndField: vi.fn(),
    countBySourceEntryAndField: vi.fn(),
  },
}))

vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: {
    findById: vi.fn(),
  },
}))

vi.mock('@/collections/collections.repository', () => ({
  collectionsRepository: {
    findById: vi.fn(),
  },
}))

import { entriesRepository } from '@/entries/entries.repository'
import { collectionsRepository } from '@/collections/collections.repository'
import { relationsRepository } from '../../relations/relations.repository'

const mockRelRepo = relationsRepository as unknown as {
  link: ReturnType<typeof vi.fn>
  unlink: ReturnType<typeof vi.fn>
  unlinkByEntries: ReturnType<typeof vi.fn>
  findBySourceEntry: ReturnType<typeof vi.fn>
  findByTargetEntry: ReturnType<typeof vi.fn>
  findBySourceEntryAndField: ReturnType<typeof vi.fn>
  countBySourceEntryAndField: ReturnType<typeof vi.fn>
}
const mockEntriesRepo = entriesRepository as unknown as {
  findById: ReturnType<typeof vi.fn>
}
const mockCollectionsRepo = collectionsRepository as unknown as {
  findById: ReturnType<typeof vi.fn>
}

describe('relationsService', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'mock-uuid' as `${string}-${string}-${string}-${string}-${string}`
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('link', () => {
    const baseLinkInput = {
      sourceEntryId: 'e1',
      targetEntryId: 'e2',
      sourceCollectionId: 'c1',
      targetCollectionId: 'c2',
      relationType: 'one-to-many' as const,
      fieldName: 'author',
    }

    it('creates a relation when both entries exist', async () => {
      mockEntriesRepo.findById
        .mockResolvedValueOnce(makeEntryRow({ id: 'e1' }))
        .mockResolvedValueOnce(makeEntryRow({ id: 'e2' }))
      const createdRelation = makeRelationRow({ id: 'mock-uuid' })
      mockRelRepo.link.mockResolvedValue(createdRelation)

      const result = await relationsService.link(db, baseLinkInput)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(createdRelation)
      }
    })

    it('rejects invalid relation type', async () => {
      const result = await relationsService.link(db, {
        ...baseLinkInput,
        relationType: 'invalid' as unknown,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Invalid relation type')
      }
    })

    it('returns NOT_FOUND when source entry does not exist', async () => {
      mockEntriesRepo.findById.mockResolvedValue(undefined)

      const result = await relationsService.link(db, baseLinkInput)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toContain('Source entry')
      }
    })

    it('returns NOT_FOUND when target entry does not exist', async () => {
      mockEntriesRepo.findById
        .mockResolvedValueOnce(makeEntryRow({ id: 'e1' }))
        .mockResolvedValueOnce(undefined)

      const result = await relationsService.link(db, baseLinkInput)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toContain('Target entry')
      }
    })

    it('enforces one-to-one cardinality', async () => {
      mockEntriesRepo.findById
        .mockResolvedValueOnce(makeEntryRow({ id: 'e1' }))
        .mockResolvedValueOnce(makeEntryRow({ id: 'e2' }))
      mockRelRepo.countBySourceEntryAndField.mockResolvedValue(1)

      const result = await relationsService.link(db, {
        ...baseLinkInput,
        relationType: 'one-to-one',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('CARDINALITY_VIOLATION')
      }
    })

    it('allows one-to-one when no existing relation', async () => {
      mockEntriesRepo.findById
        .mockResolvedValueOnce(makeEntryRow({ id: 'e1' }))
        .mockResolvedValueOnce(makeEntryRow({ id: 'e2' }))
      mockRelRepo.countBySourceEntryAndField.mockResolvedValue(0)
      mockRelRepo.link.mockResolvedValue(makeRelationRow())

      const result = await relationsService.link(db, {
        ...baseLinkInput,
        relationType: 'one-to-one',
      })

      expect(result.success).toBe(true)
    })

    it('handles UNIQUE constraint violation as DUPLICATE_RELATION', async () => {
      mockEntriesRepo.findById
        .mockResolvedValueOnce(makeEntryRow({ id: 'e1' }))
        .mockResolvedValueOnce(makeEntryRow({ id: 'e2' }))
      mockRelRepo.link.mockRejectedValue(new Error('UNIQUE constraint failed'))

      const result = await relationsService.link(db, baseLinkInput)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DUPLICATE_RELATION')
      }
    })

    it('rethrows non-unique-constraint errors', async () => {
      mockEntriesRepo.findById
        .mockResolvedValueOnce(makeEntryRow({ id: 'e1' }))
        .mockResolvedValueOnce(makeEntryRow({ id: 'e2' }))
      mockRelRepo.link.mockRejectedValue(new Error('Database connection lost'))

      await expect(relationsService.link(db, baseLinkInput)).rejects.toThrow(
        'Database connection lost'
      )
    })

    it('rejects a cross-tenant target when tenant-scoped (H2)', async () => {
      mockEntriesRepo.findById
        .mockResolvedValueOnce(makeEntryRow({ id: 'e1' }))
        .mockResolvedValueOnce(undefined)

      const result = await relationsService.link(db, baseLinkInput, 't1')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toContain('Target entry')
      }
      expect(mockRelRepo.link).not.toHaveBeenCalled()
      expect(mockEntriesRepo.findById).toHaveBeenCalledWith(db, 'e1', 't1')
      expect(mockEntriesRepo.findById).toHaveBeenCalledWith(db, 'e2', 't1')
    })

    it('stamps the explicit tenant on the created row', async () => {
      mockEntriesRepo.findById
        .mockResolvedValueOnce(makeEntryRow({ id: 'e1' }))
        .mockResolvedValueOnce(makeEntryRow({ id: 'e2' }))
      mockRelRepo.link.mockResolvedValue(makeRelationRow())

      const result = await relationsService.link(db, baseLinkInput, 't1')
      expect(result.success).toBe(true)
      expect(mockRelRepo.link).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tenantId: 't1' })
      )
    })

    it('resolves tenant from the source collection when unscoped', async () => {
      mockEntriesRepo.findById
        .mockResolvedValueOnce(makeEntryRow({ id: 'e1' }))
        .mockResolvedValueOnce(makeEntryRow({ id: 'e2' }))
      mockCollectionsRepo.findById.mockResolvedValue({ id: 'c1', tenantId: 'acme' })
      mockRelRepo.link.mockResolvedValue(makeRelationRow())

      const result = await relationsService.link(db, baseLinkInput)
      expect(result.success).toBe(true)
      expect(mockCollectionsRepo.findById).toHaveBeenCalledWith(db, 'c1')
      expect(mockRelRepo.link).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tenantId: 'acme' })
      )
    })

    it('defaults tenant to global when unscoped and collection unknown', async () => {
      mockEntriesRepo.findById
        .mockResolvedValueOnce(makeEntryRow({ id: 'e1' }))
        .mockResolvedValueOnce(makeEntryRow({ id: 'e2' }))
      mockCollectionsRepo.findById.mockResolvedValue(undefined)
      mockRelRepo.link.mockResolvedValue(makeRelationRow())

      const result = await relationsService.link(db, baseLinkInput)
      expect(result.success).toBe(true)
      expect(mockRelRepo.link).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tenantId: 'global' })
      )
    })
  })

  describe('unlink', () => {
    it('removes an existing relation', async () => {
      mockRelRepo.unlinkByEntries.mockResolvedValue(true)

      const result = await relationsService.unlink(db, {
        sourceEntryId: 'e1',
        targetEntryId: 'e2',
        fieldName: 'author',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.deleted).toBe(true)
      }
    })

    it('returns NOT_FOUND when relation does not exist', async () => {
      mockRelRepo.unlinkByEntries.mockResolvedValue(false)

      const result = await relationsService.unlink(db, {
        sourceEntryId: 'e1',
        targetEntryId: 'e2',
        fieldName: 'author',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('rejects unlink of another tenant source without deleting (H1)', async () => {
      mockEntriesRepo.findById.mockResolvedValue(undefined)

      const result = await relationsService.unlink(
        db,
        { sourceEntryId: 'e1', targetEntryId: 'e2', fieldName: 'author' },
        'other-tenant'
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
      expect(mockRelRepo.unlinkByEntries).not.toHaveBeenCalled()
    })

    it('passes tenant through to unlinkByEntries', async () => {
      mockEntriesRepo.findById.mockResolvedValue(makeEntryRow({ id: 'e1' }))
      mockRelRepo.unlinkByEntries.mockResolvedValue(true)

      const result = await relationsService.unlink(
        db,
        { sourceEntryId: 'e1', targetEntryId: 'e2', fieldName: 'author' },
        't1'
      )

      expect(result.success).toBe(true)
      expect(mockRelRepo.unlinkByEntries).toHaveBeenCalledWith(
        db,
        'e1',
        'e2',
        'author',
        't1'
      )
    })
  })

  describe('getRelationsForEntry', () => {
    it('returns relations for a source entry', async () => {
      const relations = [makeRelationRow(), makeRelationRow({ id: 'r2' })]
      mockRelRepo.findBySourceEntry.mockResolvedValue(relations)

      const result = await relationsService.getRelationsForEntry(db, 'e1')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(relations)
      }
    })

    it('filters by fieldName when provided', async () => {
      mockRelRepo.findBySourceEntry.mockResolvedValue([])

      await relationsService.getRelationsForEntry(db, 'e1', 'tags')
      expect(mockRelRepo.findBySourceEntry).toHaveBeenCalledWith(db, 'e1', 'tags', undefined)
    })

    it('passes tenant through to findBySourceEntry', async () => {
      mockRelRepo.findBySourceEntry.mockResolvedValue([])

      await relationsService.getRelationsForEntry(db, 'e1', 'tags', 't1')
      expect(mockRelRepo.findBySourceEntry).toHaveBeenCalledWith(db, 'e1', 'tags', 't1')
    })
  })

  describe('getRelationsForTarget', () => {
    it('returns reverse-lookup relations', async () => {
      const relations = [makeRelationRow({ targetEntryId: 'e2' })]
      mockRelRepo.findByTargetEntry.mockResolvedValue(relations)

      const result = await relationsService.getRelationsForTarget(db, 'e2')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(relations)
      }
    })

    it('passes tenant through to findByTargetEntry', async () => {
      mockRelRepo.findByTargetEntry.mockResolvedValue([])

      await relationsService.getRelationsForTarget(db, 'e2', 't1')
      expect(mockRelRepo.findByTargetEntry).toHaveBeenCalledWith(db, 'e2', 't1')
    })
  })
})

// ============================================================================
// Helpers
// ============================================================================

function makeEntryRow(overrides: Partial<EntryRow> = {}): EntryRow {
  return {
    id: 'test-entry-id',
    collectionId: 'test-collection-id',
    slug: 'test',
    status: 'draft',
    data: {},
    version: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    publishAt: null,
    unpublishAt: null,
    ...overrides,
  }
}

function makeRelationRow(overrides: Partial<RelationRow> = {}): RelationRow {
  return {
    id: 'test-relation-id',
    tenantId: 'test-tenant-id',
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
