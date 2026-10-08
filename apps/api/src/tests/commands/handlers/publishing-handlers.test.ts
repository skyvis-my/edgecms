import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { CommandContext } from '../../../commands/engine'

const { handlePublishNow, handleUnpublishNow } = await import(
  `../../../commands/handlers/publishing-handlers?bypass=${Date.now()}`
)

vi.mock('@/entries/entries.service', () => ({
  entriesService: {
    findById: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/scheduling/lifecycle.service', () => ({
  validateTransition: vi.fn(),
}))

import { entriesService } from '@/entries/entries.service'
import * as lifecycleService from '@/scheduling/lifecycle.service'

const mockService = entriesService as unknown as {
  findById: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}
const mockLifecycleService = lifecycleService as unknown as {
  validateTransition: ReturnType<typeof vi.fn>
}

describe('publishing-handlers', () => {
  let ctx: CommandContext

  beforeEach(() => {
    vi.clearAllMocks()
    ctx = {
      db: {} as unknown as Database,
      actor: { userId: 'user1', source: 'admin' },
    }
  })

  describe('handlePublishNow', () => {
    it('sets entry status to published', async () => {
      mockService.findById.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'draft' } as unknown,
      })
      mockLifecycleService.validateTransition.mockReturnValue({ valid: true })
      mockService.update.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'published' } as unknown,
      })

      const result = await handlePublishNow(ctx, { entryId: 'e1' })

      expect(result.success).toBe(true)
      expect(mockService.update).toHaveBeenCalledWith(
        ctx.db,
        'e1',
        { status: 'published' },
        'user1',
        undefined,
        undefined
      )
    })

    it('produces audit entry with publish action', async () => {
      mockService.findById.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'draft' } as unknown,
      })
      mockLifecycleService.validateTransition.mockReturnValue({ valid: true })
      mockService.update.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'published' } as unknown,
      })

      const result = await handlePublishNow(ctx, { entryId: 'e1' })

      expect(result.auditEntries).toHaveLength(1)
      expect(result.auditEntries?.[0].action).toBe('publish')
      expect(result.auditEntries?.[0].entityType).toBe('entry')
      expect(result.auditEntries?.[0].changes).toEqual({ status: 'published' })
    })

    it('returns error when entry not found', async () => {
      mockService.findById.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Entry not found' },
      })

      const result = await handlePublishNow(ctx, { entryId: 'missing' })
      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NOT_FOUND')
    })
  })

  describe('handleUnpublishNow', () => {
    it('sets entry status to draft', async () => {
      mockService.findById.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'published' } as unknown,
      })
      mockLifecycleService.validateTransition.mockReturnValue({ valid: true })
      mockService.update.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'draft' } as unknown,
      })

      const result = await handleUnpublishNow(ctx, { entryId: 'e1' })

      expect(result.success).toBe(true)
      expect(mockService.update).toHaveBeenCalledWith(
        ctx.db,
        'e1',
        { status: 'draft' },
        'user1',
        undefined,
        undefined
      )
    })

    it('produces audit entry with unpublish action', async () => {
      mockService.findById.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'published' } as unknown,
      })
      mockLifecycleService.validateTransition.mockReturnValue({ valid: true })
      mockService.update.mockResolvedValue({
        success: true,
        data: { id: 'e1', status: 'draft' } as unknown,
      })

      const result = await handleUnpublishNow(ctx, { entryId: 'e1' })

      expect(result.auditEntries).toHaveLength(1)
      expect(result.auditEntries?.[0].action).toBe('unpublish')
      expect(result.auditEntries?.[0].changes).toEqual({ status: 'draft' })
    })

    it('returns error when entry not found', async () => {
      mockService.findById.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Entry not found' },
      })

      const result = await handleUnpublishNow(ctx, { entryId: 'missing' })
      expect(result.success).toBe(false)
    })
  })

  it('cannot publish an entry from another tenant scope', async () => {
    ctx.tenantScope = 'tenant-a'
    mockService.findById.mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: "Entry 'tenant-b-entry' not found" },
    })

    const result = await handlePublishNow(ctx, { entryId: 'tenant-b-entry' })

    expect(result.success).toBe(false)
    expect(mockService.findById).toHaveBeenCalledWith(ctx.db, 'tenant-b-entry', 'tenant-a')
    expect(mockService.update).not.toHaveBeenCalled()
  })
})
