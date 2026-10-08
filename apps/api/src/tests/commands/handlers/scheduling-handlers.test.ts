import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { EntryRow } from '@/entries/entries.repository'
import type { Env } from '@/env'
import type { CommandContext } from '../../../commands/engine'

// Mock the dependencies
vi.mock('@/entries/entries.service', () => ({
  entriesService: {
    findById: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/scheduling/scheduler.service', () => ({
  notifySchedule: vi.fn(),
  cancelSchedule: vi.fn(),
}))

vi.mock('@/scheduling/lifecycle.service', () => ({
  validateTransition: vi.fn(),
}))

vi.mock('@/collections/collections.repository', () => ({
  collectionsRepository: {
    findById: vi.fn(),
  },
}))

vi.mock('@/observability/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

import { entriesService } from '@/entries/entries.service'
import { collectionsRepository } from '@/collections/collections.repository'
import { logger } from '@/observability/logger'
import * as lifecycleService from '@/scheduling/lifecycle.service'
import * as schedulerService from '@/scheduling/scheduler.service'

// Import handlers with cache bypass after mocks are configured.
const { handleSchedulePublish, handleScheduleUnpublish, handleCancelSchedule } = await import(
  `../../../commands/handlers/scheduling-handlers?bypass=${Date.now()}`
)

const mockEntriesService = entriesService as unknown as {
  findById: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

const mockSchedulerService = schedulerService as unknown as {
  notifySchedule: ReturnType<typeof vi.fn>
  cancelSchedule: ReturnType<typeof vi.fn>
}

const mockCollectionsRepository = collectionsRepository as unknown as {
  findById: ReturnType<typeof vi.fn>
}

const mockLifecycleService = lifecycleService as unknown as {
  validateTransition: ReturnType<typeof vi.fn>
}
const mockLogger = logger as unknown as {
  error: ReturnType<typeof vi.fn>
}

describe('Scheduling Handlers', () => {
  let mockDb: Database
  let mockEnv: Env
  let ctx: CommandContext

  beforeEach(() => {
    mockDb = {} as Database
    mockEnv = {
      PUBLISH_SCHEDULER: {
        idFromName: vi.fn(),
        get: vi.fn(),
      },
    } as unknown as Env

    ctx = {
      db: mockDb,
      actor: { userId: 'user-123', source: 'admin' },
      env: mockEnv,
    }

    // Reset mocks
    vi.clearAllMocks()
    mockCollectionsRepository.findById.mockResolvedValue({
      id: 'col-1',
      slug: 'posts',
      supportedLocales: ['en'],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('handleSchedulePublish', () => {
    it('should schedule publish with valid transition from draft to scheduled', async () => {
      const entryId = 'entry-123'
      const publishAt = '2026-12-31T23:59:59Z'

      // Mock entry lookup — entry is in draft status
      const mockEntry: EntryRow = {
        id: entryId,
        collectionId: 'col-1',
        slug: 'test-entry',
        status: 'draft',
        data: { title: 'Test' },
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        publishAt: null,
        unpublishAt: null,
      }

      mockEntriesService.findById.mockResolvedValue({
        success: true,
        data: mockEntry,
      })

      // Mock lifecycle validation
      mockLifecycleService.validateTransition.mockReturnValue({ valid: true })

      // Mock update
      mockEntriesService.update.mockResolvedValue({
        success: true,
        data: { ...mockEntry, status: 'scheduled', publishAt, version: 2 },
      })

      // Mock scheduler notification
      mockSchedulerService.notifySchedule.mockResolvedValue(undefined)

      const result = await handleSchedulePublish(ctx, { entryId, publishAt })

      expect(result.success).toBe(true)
      expect(result.auditEntries).toHaveLength(1)
      expect(result.auditEntries?.[0]).toMatchObject({
        entityType: 'entry',
        entityId: entryId,
        action: 'schedulePublish',
        changes: { status: 'scheduled', publishAt },
      })
      expect(entriesService.update).toHaveBeenCalledWith(
        mockDb,
        entryId,
        { status: 'scheduled', publishAt },
        'user-123',
        undefined,
        undefined
      )
      expect(schedulerService.notifySchedule).toHaveBeenCalledWith(
        mockEnv,
        entryId,
        'publish',
        publishAt,
        {
          collectionSlug: 'posts',
          locales: ['en'],
          tenantScope: undefined,
        }
      )
    })

    it('should fail with invalid transition from archived to scheduled', async () => {
      const entryId = 'entry-123'
      const publishAt = '2026-12-31T23:59:59Z'

      const mockEntry: EntryRow = {
        id: entryId,
        collectionId: 'col-1',
        slug: 'test-entry',
        status: 'archived',
        data: { title: 'Test' },
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        publishAt: null,
        unpublishAt: null,
      }

      mockEntriesService.findById.mockResolvedValue({
        success: true,
        data: mockEntry,
      })

      // Mock lifecycle validation (invalid transition)
      mockLifecycleService.validateTransition.mockReturnValue({
        valid: false,
        error: "Cannot transition from 'archived' to 'scheduled'",
      })

      const result = await handleSchedulePublish(ctx, { entryId, publishAt })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_TRANSITION')
      expect(entriesService.update).not.toHaveBeenCalled()
      expect(schedulerService.notifySchedule).not.toHaveBeenCalled()
    })

    it('should fail when entry not found', async () => {
      const entryId = 'nonexistent'
      const publishAt = '2026-12-31T23:59:59Z'

      mockEntriesService.findById.mockResolvedValue({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Entry not found' },
      })

      const result = await handleSchedulePublish(ctx, { entryId, publishAt })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('NOT_FOUND')
      expect(entriesService.update).not.toHaveBeenCalled()
    })

    it('should succeed even if scheduler notification fails (non-blocking)', async () => {
      const entryId = 'entry-123'
      const publishAt = '2026-12-31T23:59:59Z'

      const mockEntry: EntryRow = {
        id: entryId,
        collectionId: 'col-1',
        slug: 'test-entry',
        status: 'draft',
        data: { title: 'Test' },
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        publishAt: null,
        unpublishAt: null,
      }

      mockEntriesService.findById.mockResolvedValue({
        success: true,
        data: mockEntry,
      })

      // Mock lifecycle validation
      mockLifecycleService.validateTransition.mockReturnValue({ valid: true })

      mockEntriesService.update.mockResolvedValue({
        success: true,
        data: { ...mockEntry, status: 'scheduled', publishAt, version: 2 },
      })

      // Scheduler notification fails
      mockSchedulerService.notifySchedule.mockRejectedValue(new Error('DO unavailable'))

      const result = await handleSchedulePublish(ctx, { entryId, publishAt })

      expect(result.success).toBe(true)
      expect(mockLogger.error).toHaveBeenCalledWith(
        'scheduler_notification_failed',
        expect.objectContaining({
          error: 'DO unavailable',
        })
      )
    })
  })

  describe('handleScheduleUnpublish', () => {
    it('should schedule unpublish on a published entry', async () => {
      const entryId = 'entry-123'
      const unpublishAt = '2026-12-31T23:59:59Z'

      const mockEntry: EntryRow = {
        id: entryId,
        collectionId: 'col-1',
        slug: 'test-entry',
        status: 'published',
        data: { title: 'Test' },
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        publishAt: null,
        unpublishAt: null,
      }

      mockEntriesService.findById.mockResolvedValue({
        success: true,
        data: mockEntry,
      })

      mockEntriesService.update.mockResolvedValue({
        success: true,
        data: { ...mockEntry, unpublishAt, version: 2 },
      })

      mockSchedulerService.notifySchedule.mockResolvedValue(undefined)

      const result = await handleScheduleUnpublish(ctx, { entryId, unpublishAt })

      expect(result.success).toBe(true)
      expect(result.auditEntries).toHaveLength(1)
      expect(result.auditEntries?.[0]).toMatchObject({
        entityType: 'entry',
        entityId: entryId,
        action: 'scheduleUnpublish',
        changes: { unpublishAt },
      })
      expect(entriesService.update).toHaveBeenCalledWith(
        mockDb,
        entryId,
        { unpublishAt },
        'user-123',
        undefined,
        undefined
      )
      expect(schedulerService.notifySchedule).toHaveBeenCalledWith(
        mockEnv,
        entryId,
        'unpublish',
        unpublishAt,
        {
          collectionSlug: 'posts',
          locales: ['en'],
          tenantScope: undefined,
        }
      )
    })

    it('should fail when entry is not published', async () => {
      const entryId = 'entry-123'
      const unpublishAt = '2026-12-31T23:59:59Z'

      const mockEntry: EntryRow = {
        id: entryId,
        collectionId: 'col-1',
        slug: 'test-entry',
        status: 'draft',
        data: { title: 'Test' },
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        publishAt: null,
        unpublishAt: null,
      }

      mockEntriesService.findById.mockResolvedValue({
        success: true,
        data: mockEntry,
      })

      const result = await handleScheduleUnpublish(ctx, { entryId, unpublishAt })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('INVALID_TRANSITION')
      expect(result.error?.message).toContain('published entries')
      expect(entriesService.update).not.toHaveBeenCalled()
    })
  })

  describe('handleCancelSchedule', () => {
    it('should cancel scheduled publish and transition to draft', async () => {
      const entryId = 'entry-123'

      const mockEntry: EntryRow = {
        id: entryId,
        collectionId: 'col-1',
        slug: 'test-entry',
        status: 'scheduled',
        data: { title: 'Test' },
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        publishAt: '2026-12-31T23:59:59Z',
        unpublishAt: null,
      }

      mockEntriesService.findById.mockResolvedValue({
        success: true,
        data: mockEntry,
      })

      // Mock lifecycle validation
      mockLifecycleService.validateTransition.mockReturnValue({ valid: true })

      mockEntriesService.update.mockResolvedValue({
        success: true,
        data: { ...mockEntry, status: 'draft', publishAt: null, version: 2 },
      })

      mockSchedulerService.cancelSchedule.mockResolvedValue(undefined)

      const result = await handleCancelSchedule(ctx, { entryId })

      expect(result.success).toBe(true)
      expect(result.auditEntries).toHaveLength(1)
      expect(result.auditEntries?.[0]).toMatchObject({
        entityType: 'entry',
        entityId: entryId,
        action: 'cancelSchedule',
        changes: { status: 'draft', publishAt: null, unpublishAt: null },
      })
      expect(entriesService.update).toHaveBeenCalledWith(
        mockDb,
        entryId,
        { status: 'draft', publishAt: null, unpublishAt: null },
        'user-123',
        undefined,
        undefined
      )
      expect(schedulerService.cancelSchedule).toHaveBeenCalledTimes(2)
    })

    it('should cancel scheduled unpublish without changing published status', async () => {
      const entryId = 'entry-123'

      const mockEntry: EntryRow = {
        id: entryId,
        collectionId: 'col-1',
        slug: 'test-entry',
        status: 'published',
        data: { title: 'Test' },
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        publishAt: null,
        unpublishAt: '2026-12-31T23:59:59Z',
      }

      mockEntriesService.findById.mockResolvedValue({
        success: true,
        data: mockEntry,
      })

      mockEntriesService.update.mockResolvedValue({
        success: true,
        data: { ...mockEntry, unpublishAt: null, version: 2 },
      })

      mockSchedulerService.cancelSchedule.mockResolvedValue(undefined)

      const result = await handleCancelSchedule(ctx, { entryId })

      expect(result.success).toBe(true)
      expect(result.auditEntries?.[0].changes).toMatchObject({
        publishAt: null,
        unpublishAt: null,
        // status should NOT be set (stays published)
      })
      expect(entriesService.update).toHaveBeenCalledWith(
        mockDb,
        entryId,
        { publishAt: null, unpublishAt: null },
        'user-123',
        undefined,
        undefined
      )
    })
  })
})
