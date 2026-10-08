import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { CommandContext } from '../../../commands/engine'

vi.mock('@/entries/entries.service', () => ({
  entriesService: {
    create: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
  },
}))

import { entriesService } from '@/entries/entries.service'

// Dynamic import to bypass cache/mock from other tests
const {
  handleBulkUpdate,
  handleCreateEntry,
  handleDeleteEntry,
  handleUpdateEntry,
  handleUpdateSingleton,
} = await import(`../../../commands/handlers/entry-handlers?bypass=${Date.now()}`)

const mockService = entriesService as unknown as {
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  deleteById: ReturnType<typeof vi.fn>
  findById: ReturnType<typeof vi.fn>
  findAll: ReturnType<typeof vi.fn>
}

describe('entry-handlers', () => {
  let ctx: CommandContext

  beforeEach(() => {
    vi.clearAllMocks()
    ctx = {
      db: {} as unknown as Database,
      actor: { userId: 'user1', source: 'admin' },
    }
    mockService.findById.mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Entry not found' },
    })
  })

  describe('handleCreateEntry', () => {
    it('creates an entry and returns audit entry', async () => {
      mockService.create.mockResolvedValue({
        success: true,
        data: {
          id: 'e1',
          collectionId: 'c1',
          slug: 'test',
          status: 'draft',
          data: { title: 'Test' },
          version: 1,
          createdAt: '2026-01-15T10:00:00.000Z',
          updatedAt: '2026-01-15T10:00:00.000Z',
        } as unknown,
      })

      const result = await handleCreateEntry(ctx, {
        collectionId: 'c1',
        data: { title: 'Test' },
      })

      expect(result.success).toBe(true)
      expect(result.auditEntries).toHaveLength(1)
      expect(result.auditEntries?.[0].action).toBe('create')
      expect(result.auditEntries?.[0].entityType).toBe('entry')
      expect(result.auditEntries?.[0].changes).toEqual(
        expect.objectContaining({
          id: 'e1',
          collectionId: 'c1',
          data: { title: 'Test' },
          version: 1,
        })
      )
    })

    it('returns error when service fails', async () => {
      mockService.create.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Collection not found' },
      })

      const result = await handleCreateEntry(ctx, {
        collectionId: 'bad',
        data: {},
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NOT_FOUND')
    })

    it('rejects direct publish lifecycle status during create', async () => {
      const result = await handleCreateEntry(ctx, {
        collectionId: 'c1',
        status: 'published',
        data: { title: 'Test' },
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_STATUS_TRANSITION')
      expect(result.error?.message).toContain('publishNow')
      expect(mockService.create).not.toHaveBeenCalled()
    })
  })

  describe('handleUpdateEntry', () => {
    it('updates an entry and returns audit entry', async () => {
      mockService.update.mockResolvedValue({
        success: true,
        data: { id: 'e1', version: 2 } as unknown,
      })

      const result = await handleUpdateEntry(ctx, {
        entryId: 'e1',
        data: { title: 'Updated' },
      })

      expect(result.success).toBe(true)
      expect(result.auditEntries).toHaveLength(1)
      expect(result.auditEntries?.[0].action).toBe('update')
    })

    it('performs optimistic version check', async () => {
      mockService.update.mockResolvedValue({
        success: false,
        error: { code: 'VERSION_CONFLICT', message: 'stale version' },
      })

      const result = await handleUpdateEntry(ctx, { entryId: 'e1', data: {} }, 2)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('VERSION_CONFLICT')
    })

    it('passes version check when versions match', async () => {
      mockService.update.mockResolvedValue({
        success: true,
        data: { id: 'e1', version: 3 } as unknown,
      })

      const result = await handleUpdateEntry(ctx, { entryId: 'e1', data: { title: 'Test' } }, 2)

      expect(result.success).toBe(true)
      expect(mockService.update).toHaveBeenCalledWith(
        ctx.db,
        'e1',
        { slug: undefined, status: undefined, data: { title: 'Test' } },
        'user1',
        2,
        undefined
      )
    })

    it('returns NOT_FOUND during version check if entry missing', async () => {
      mockService.update.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Entry not found' },
      })

      const result = await handleUpdateEntry(ctx, { entryId: 'missing', data: {} }, 1)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NOT_FOUND')
    })

    it('emits full updated entry payload in audit changes for sync consumers', async () => {
      mockService.update.mockResolvedValue({
        success: true,
        data: {
          id: 'e1',
          collectionId: 'c1',
          slug: 'entry-1',
          status: 'draft',
          data: { title: 'Updated' },
          version: 2,
          createdAt: '2026-01-15T10:00:00.000Z',
          updatedAt: '2026-01-15T10:00:01.000Z',
        } as unknown,
      })

      const result = await handleUpdateEntry(ctx, { entryId: 'e1', data: { title: 'Updated' } })

      expect(result.success).toBe(true)
      expect(result.auditEntries?.[0]?.changes).toEqual(
        expect.objectContaining({
          id: 'e1',
          collectionId: 'c1',
          version: 2,
          data: { title: 'Updated' },
        })
      )
    })

    it('rejects direct publish lifecycle status changes during update', async () => {
      mockService.findById.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'draft' } as unknown,
      })

      const result = await handleUpdateEntry(ctx, {
        entryId: 'e1',
        status: 'published',
        data: { title: 'Updated' },
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_STATUS_TRANSITION')
      expect(result.error?.message).toContain('publishNow')
      expect(mockService.update).not.toHaveBeenCalled()
    })

    it('rejects direct unpublish lifecycle status changes during update', async () => {
      mockService.findById.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'published' } as unknown,
      })

      const result = await handleUpdateEntry(ctx, {
        entryId: 'e1',
        status: 'draft',
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_STATUS_TRANSITION')
      expect(result.error?.message).toContain('unpublishNow')
      expect(mockService.update).not.toHaveBeenCalled()
    })
  })

  describe('handleDeleteEntry', () => {
    it('deletes an entry and returns audit entry', async () => {
      mockService.deleteById.mockResolvedValue({
        success: true,
        data: { id: 'e1' },
      })

      const result = await handleDeleteEntry(ctx, { entryId: 'e1' })

      expect(result.success).toBe(true)
      expect(result.auditEntries).toHaveLength(1)
      expect(result.auditEntries?.[0].action).toBe('delete')
    })

    it('returns error when entry not found', async () => {
      mockService.deleteById.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Entry not found' },
      })

      const result = await handleDeleteEntry(ctx, { entryId: 'missing' })
      expect(result.success).toBe(false)
    })
  })

  describe('tenant isolation', () => {
    it('passes tenant scope to update and delete calls', async () => {
      ctx.tenantScope = 'tenant-a'
      mockService.update.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: "Entry 'e2' not found" },
      })
      mockService.deleteById.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: "Entry 'e2' not found" },
      })

      const updateResult = await handleUpdateEntry(ctx, { entryId: 'e2', data: { title: 'X' } })
      const deleteResult = await handleDeleteEntry(ctx, { entryId: 'e2' })

      expect(updateResult.success).toBe(false)
      expect(deleteResult.success).toBe(false)
      expect(mockService.update).toHaveBeenCalledWith(
        ctx.db,
        'e2',
        { slug: undefined, status: undefined, data: { title: 'X' } },
        'user1',
        undefined,
        'tenant-a'
      )
      expect(mockService.deleteById).toHaveBeenCalledWith(ctx.db, 'e2', 'tenant-a')
    })
  })

  describe('handleBulkUpdate', () => {
    it('updates multiple entries and produces audit entries', async () => {
      mockService.update
        .mockResolvedValueOnce({
          success: true,
          data: {
            id: 'e1',
            collectionId: 'c1',
            slug: 'entry-1',
            status: 'published',
            data: { title: 'One' },
            version: 2,
          } as unknown,
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            id: 'e2',
            collectionId: 'c1',
            slug: 'entry-2',
            status: 'published',
            data: { title: 'Two' },
            version: 3,
          } as unknown,
        })

      const result = await handleBulkUpdate(ctx, {
        entryIds: ['e1', 'e2'],
        updates: { data: { reviewed: true } },
      })

      expect(result.success).toBe(true)
      expect(result.auditEntries).toHaveLength(2)
      expect(result.data?.totalUpdated).toBe(2)
      expect(result.data?.totalFailed).toBe(0)
      expect(result.auditEntries?.[0]?.changes).toEqual(
        expect.objectContaining({
          id: 'e1',
          collectionId: 'c1',
          status: 'published',
        })
      )
      expect(result.auditEntries?.[1]?.changes).toEqual(
        expect.objectContaining({
          id: 'e2',
          collectionId: 'c1',
          status: 'published',
        })
      )
    })

    it('collects errors for failed entries', async () => {
      mockService.update
        .mockResolvedValueOnce({ success: true, data: { id: 'e1' } as unknown })
        .mockResolvedValueOnce({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Entry not found' },
        })

      const result = await handleBulkUpdate(ctx, {
        entryIds: ['e1', 'e2'],
        updates: { data: { reviewed: true } },
      })

      // Partial success
      expect(result.success).toBe(true)
      expect(result.data?.totalUpdated).toBe(1)
      expect(result.data?.totalFailed).toBe(1)
    })

    it('returns failure when all updates fail', async () => {
      mockService.update.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Not found' },
      })

      const result = await handleBulkUpdate(ctx, {
        entryIds: ['e1', 'e2'],
        updates: { data: { reviewed: true } },
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('BULK_UPDATE_FAILED')
    })

    it('rejects bulk publish lifecycle status changes before updating entries', async () => {
      mockService.findById.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'draft' } as unknown,
      })

      const result = await handleBulkUpdate(ctx, {
        entryIds: ['e1'],
        updates: { status: 'published' },
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_STATUS_TRANSITION')
      expect(result.error?.message).toContain('publishNow')
      expect(mockService.update).not.toHaveBeenCalled()
    })

    it('rejects bulk unpublish lifecycle status changes before updating entries', async () => {
      mockService.findById.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'published' } as unknown,
      })

      const result = await handleBulkUpdate(ctx, {
        entryIds: ['e1'],
        updates: { status: 'draft' },
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_STATUS_TRANSITION')
      expect(result.error?.message).toContain('unpublishNow')
      expect(mockService.update).not.toHaveBeenCalled()
    })
  })

  describe('handleUpdateSingleton', () => {
    it('updates existing singleton entry', async () => {
      mockService.findAll.mockResolvedValue({
        success: true,
        data: {
          entries: [{ id: 'e1' } as unknown],
          total: 1,
          page: 1,
          perPage: 1,
        },
      })
      mockService.update.mockResolvedValue({
        success: true,
        data: {
          id: 'e1',
          collectionId: 'c1',
          slug: 'singleton',
          status: 'draft',
          data: { title: 'Updated' },
          version: 2,
        } as unknown,
      })

      const result = await handleUpdateSingleton(ctx, {
        collectionId: 'c1',
        data: { title: 'Updated' },
      })

      expect(result.success).toBe(true)
      expect(result.auditEntries?.[0].action).toBe('update')
      expect(result.auditEntries?.[0]?.changes).toEqual(
        expect.objectContaining({
          id: 'e1',
          collectionId: 'c1',
          data: { title: 'Updated' },
        })
      )
    })

    it('creates new singleton entry when none exists', async () => {
      mockService.findAll.mockResolvedValue({
        success: true,
        data: { entries: [], total: 0, page: 1, perPage: 1 },
      })
      mockService.create.mockResolvedValue({
        success: true,
        data: {
          id: 'e1',
          collectionId: 'c1',
          slug: 'singleton',
          status: 'draft',
          data: { title: 'New' },
          version: 1,
        } as unknown,
      })

      const result = await handleUpdateSingleton(ctx, {
        collectionId: 'c1',
        data: { title: 'New' },
      })

      expect(result.success).toBe(true)
      expect(result.auditEntries?.[0].action).toBe('create')
      expect(result.auditEntries?.[0]?.changes).toEqual(
        expect.objectContaining({
          id: 'e1',
          collectionId: 'c1',
          data: { title: 'New' },
        })
      )
    })

    it('returns error when findAll fails', async () => {
      mockService.findAll.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Collection not found' },
      })

      const result = await handleUpdateSingleton(ctx, {
        collectionId: 'bad',
        data: {},
      })

      expect(result.success).toBe(false)
    })
  })
})
