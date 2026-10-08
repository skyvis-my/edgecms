import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { CommandContext } from '../../../commands/engine'

mock.module('@/relations/relations.service', () => ({
  relationsService: {
    link: vi.fn(),
    unlink: vi.fn(),
  },
}))

import { relationsService } from '@/relations/relations.service'

// Dynamic import to bypass cache/mock from other tests
const { handleLinkRelation, handleUnlinkRelation } = await import(
  `../../../commands/handlers/relation-handlers?bypass=${Date.now()}`
)

const mockLink = relationsService.link as unknown as ReturnType<typeof mock>
const mockUnlink = relationsService.unlink as unknown as ReturnType<typeof mock>

describe('relation-handlers', () => {
  let ctx: CommandContext

  beforeEach(() => {
    vi.clearAllMocks()
    ctx = {
      db: {} as unknown as Database,
      actor: { userId: 'user1', source: 'admin' },
    }
  })

  describe('handleLinkRelation', () => {
    it('creates a relation and returns audit entry', async () => {
      mockLink.mockResolvedValue({
        success: true,
        data: { id: 'r1' } as unknown,
      })

      const result = await handleLinkRelation(ctx, {
        sourceEntryId: 'e1',
        targetEntryId: 'e2',
        sourceCollectionId: 'c1',
        targetCollectionId: 'c2',
        relationType: 'one-to-many',
        fieldName: 'tags',
      })

      expect(result.success).toBe(true)
      expect(result.auditEntries).toHaveLength(1)
      expect(result.auditEntries?.[0].action).toBe('link')
      expect(result.auditEntries?.[0].entityType).toBe('relation')
    })

    it('passes sortOrder to service', async () => {
      mockLink.mockResolvedValue({
        success: true,
        data: { id: 'r1' } as unknown,
      })

      await handleLinkRelation(ctx, {
        sourceEntryId: 'e1',
        targetEntryId: 'e2',
        sourceCollectionId: 'c1',
        targetCollectionId: 'c2',
        relationType: 'many-to-many',
        fieldName: 'tags',
        sortOrder: 5,
      })

      expect(mockLink).toHaveBeenCalledWith(ctx.db, expect.objectContaining({ sortOrder: 5 }))
    })

    it('returns error when service fails', async () => {
      mockLink.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Source entry not found' },
      })

      const result = await handleLinkRelation(ctx, {
        sourceEntryId: 'bad',
        targetEntryId: 'e2',
        sourceCollectionId: 'c1',
        targetCollectionId: 'c2',
        relationType: 'one-to-many',
        fieldName: 'tags',
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NOT_FOUND')
    })
  })

  describe('handleUnlinkRelation', () => {
    it('removes a relation and returns audit entry', async () => {
      mockUnlink.mockResolvedValue({
        success: true,
        data: { deleted: true },
      })

      const result = await handleUnlinkRelation(ctx, {
        sourceEntryId: 'e1',
        targetEntryId: 'e2',
        fieldName: 'tags',
      })

      expect(result.success).toBe(true)
      expect(result.auditEntries).toHaveLength(1)
      expect(result.auditEntries?.[0].action).toBe('unlink')
      expect(result.auditEntries?.[0].entityType).toBe('relation')
    })

    it('constructs composite entity ID for audit', async () => {
      mockUnlink.mockResolvedValue({
        success: true,
        data: { deleted: true },
      })

      const result = await handleUnlinkRelation(ctx, {
        sourceEntryId: 'e1',
        targetEntryId: 'e2',
        fieldName: 'author',
      })

      expect(result.auditEntries?.[0].entityId).toBe('e1:author:e2')
    })

    it('returns error when relation not found', async () => {
      mockUnlink.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Relation not found' },
      })

      const result = await handleUnlinkRelation(ctx, {
        sourceEntryId: 'e1',
        targetEntryId: 'e2',
        fieldName: 'tags',
      })

      expect(result.success).toBe(false)
    })
  })
})
