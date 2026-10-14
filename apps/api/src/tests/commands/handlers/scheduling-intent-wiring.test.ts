import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import type { CommandContext } from '../../../commands/engine'

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

vi.mock('@/scheduling/schedule-intents.repository', () => ({
  scheduleIntentsRepository: {
    upsertIntent: vi.fn(),
    markDone: vi.fn(),
    markFailed: vi.fn(),
    claimPending: vi.fn(),
  },
}))

vi.mock('@/observability/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

import { entriesService } from '@/entries/entries.service'
import * as schedulerService from '@/scheduling/scheduler.service'
import * as lifecycleService from '@/scheduling/lifecycle.service'
import { scheduleIntentsRepository } from '@/scheduling/schedule-intents.repository'

const { handleSchedulePublish, handleCancelSchedule } = await import(
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
const mockLifecycleService = lifecycleService as unknown as {
  validateTransition: ReturnType<typeof vi.fn>
}
const mockIntents = scheduleIntentsRepository as unknown as {
  upsertIntent: ReturnType<typeof vi.fn>
  markDone: ReturnType<typeof vi.fn>
}

describe('Scheduling handlers schedule-intent wiring', () => {
  let mockDb: Database
  let ctx: CommandContext

  beforeEach(() => {
    mockDb = {} as Database
    ctx = {
      db: mockDb,
      env: {
        PUBLISH_SCHEDULER: { idFromName: vi.fn(), get: vi.fn() },
      } as unknown as Env,
      actor: { userId: 'u1' },
      tenantScope: 't1',
    } as unknown as CommandContext
    mockEntriesService.findById.mockResolvedValue({
      success: true,
      data: { id: 'e1', collectionId: 'c1', status: 'draft' },
    })
    mockLifecycleService.validateTransition.mockReturnValue({ valid: true })
    mockEntriesService.update.mockResolvedValue({ success: true, data: { id: 'e1' } })
    mockSchedulerService.notifySchedule.mockResolvedValue(undefined)
    mockSchedulerService.cancelSchedule.mockResolvedValue(undefined)
    mockIntents.upsertIntent.mockResolvedValue(undefined)
    mockIntents.markDone.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('records a pending publish intent and marks it done after notify', async () => {
    const result = await handleSchedulePublish(ctx, {
      entryId: 'e1',
      publishAt: '2026-10-20T00:00:00.000Z',
    })

    expect(result.success).toBe(true)
    expect(mockIntents.upsertIntent).toHaveBeenCalledWith(mockDb, {
      entryId: 'e1',
      transitionType: 'publish',
      scheduledAt: '2026-10-20T00:00:00.000Z',
      tenantScope: 't1',
      status: 'pending',
    })
    expect(mockIntents.markDone).toHaveBeenCalledWith(mockDb, 'e1', 'publish')
  })

  it('leaves the intent pending when notify fails', async () => {
    mockSchedulerService.notifySchedule.mockRejectedValue(new Error('DO down'))

    const result = await handleSchedulePublish(ctx, {
      entryId: 'e1',
      publishAt: '2026-10-20T00:00:00.000Z',
    })

    // Command still succeeds (best-effort notify); sweeper replays the intent.
    expect(result.success).toBe(true)
    expect(mockIntents.upsertIntent).toHaveBeenCalledTimes(1)
    expect(mockIntents.markDone).not.toHaveBeenCalled()
  })

  it('records cancelled intents and clears them after DO cancel', async () => {
    mockEntriesService.findById.mockResolvedValue({
      success: true,
      data: { id: 'e1', collectionId: 'c1', status: 'scheduled' },
    })

    const result = await handleCancelSchedule(ctx, { entryId: 'e1' })

    expect(result.success).toBe(true)
    expect(mockIntents.upsertIntent).toHaveBeenCalledWith(mockDb, {
      entryId: 'e1',
      transitionType: 'publish',
      scheduledAt: null,
      tenantScope: 't1',
      status: 'cancelled',
    })
    expect(mockIntents.upsertIntent).toHaveBeenCalledWith(mockDb, {
      entryId: 'e1',
      transitionType: 'unpublish',
      scheduledAt: null,
      tenantScope: 't1',
      status: 'cancelled',
    })
    expect(mockIntents.markDone).toHaveBeenCalledWith(mockDb, 'e1', 'publish')
    expect(mockIntents.markDone).toHaveBeenCalledWith(mockDb, 'e1', 'unpublish')
    if (result.success) {
      expect(result.data).not.toHaveProperty('schedulerSyncRequired')
    }
  })

  it('flags schedulerSyncRequired and keeps intents open when DO cancel fails', async () => {
    mockEntriesService.findById.mockResolvedValue({
      success: true,
      data: { id: 'e1', collectionId: 'c1', status: 'scheduled' },
    })
    mockSchedulerService.cancelSchedule.mockRejectedValue(new Error('DO down'))

    const result = await handleCancelSchedule(ctx, { entryId: 'e1' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toMatchObject({ schedulerSyncRequired: true })
    }
    expect(mockIntents.markDone).not.toHaveBeenCalled()
  })
})
