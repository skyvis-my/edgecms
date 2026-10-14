import { describe, expect, it, vi, beforeEach } from 'bun:test'
import type { Database } from '@/database/db'
import type { Env } from '@/env'

vi.mock('../../scheduling/scheduler.service', () => ({
  notifySchedule: vi.fn(),
  cancelSchedule: vi.fn(),
}))

vi.mock('../../entries/entries.repository', () => ({
  entriesRepository: {
    findById: vi.fn(),
  },
}))

vi.mock('@/observability/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

import { scheduleIntentsRepository, sweepScheduleIntents } from '../../scheduling/schedule-intents.repository'
import { entriesRepository } from '@/entries/entries.repository'
import * as schedulerService from '@/scheduling/scheduler.service'

const mockEntriesRepository = entriesRepository as unknown as {
  findById: ReturnType<typeof vi.fn>
}
const mockSchedulerService = schedulerService as unknown as {
  notifySchedule: ReturnType<typeof vi.fn>
  cancelSchedule: ReturnType<typeof vi.fn>
}

function chainableSelect(rows: unknown[]) {
  const all = vi.fn(async () => rows)
  const limit = vi.fn(() => ({ all }))
  const orderBy = vi.fn(() => ({ limit, all }))
  const where = vi.fn(() => ({ orderBy, limit, all }))
  const from = vi.fn(() => ({ where }))
  return { select: vi.fn(() => ({ from })), all, limit, orderBy, where }
}

function chainableUpdate(returningRows: unknown[] = [{ id: 'x' }]) {
  const returning = vi.fn(async () => returningRows)
  const where = vi.fn(() => ({ returning }))
  const set = vi.fn(() => ({ where }))
  return { update: vi.fn(() => ({ set })), set, where, returning }
}

function chainableInsert() {
  const onConflictDoNothing = vi.fn(async () => undefined)
  const onConflictDoUpdate = vi.fn(async () => undefined)
  const values = vi.fn(() => ({ onConflictDoNothing, onConflictDoUpdate }))
  return { insert: vi.fn(() => ({ values })), values, onConflictDoNothing, onConflictDoUpdate }
}

const INTENT = {
  id: 'i1',
  entryId: 'e1',
  transitionType: 'publish',
  scheduledAt: '2026-10-20T00:00:00.000Z',
  tenantScope: 't1',
  status: 'pending',
  attempts: 0,
  nextAttemptAt: null,
  createdAt: '2026-10-14T00:00:00.000Z',
  updatedAt: '2026-10-14T00:00:00.000Z',
}

describe('scheduleIntentsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upsertIntent updates an existing row', async () => {
    const { update, set, where, returning } = chainableUpdate([{ id: 'i1' }])
    const db = { update }

    await scheduleIntentsRepository.upsertIntent(db as unknown as Database, {
      entryId: 'e1',
      transitionType: 'publish',
      scheduledAt: '2026-10-20T00:00:00.000Z',
      tenantScope: 't1',
      status: 'pending',
    })

    expect(update).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', scheduledAt: '2026-10-20T00:00:00.000Z' })
    )
    expect(where).toHaveBeenCalledTimes(1)
    expect(returning).toHaveBeenCalledTimes(1)
  })

  it('upsertIntent inserts when no row was updated', async () => {
    const { update } = chainableUpdate([])
    const { insert, values, onConflictDoUpdate } = chainableInsert()
    const db = { update, insert }

    await scheduleIntentsRepository.upsertIntent(db as unknown as Database, {
      entryId: 'e1',
      transitionType: 'publish',
      scheduledAt: '2026-10-20T00:00:00.000Z',
      status: 'pending',
    })

    expect(insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledTimes(1)
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1)
  })

  it('upsertIntent is a safe no-op on drivers without update/insert', async () => {
    await scheduleIntentsRepository.upsertIntent({} as Database, {
      entryId: 'e1',
      transitionType: 'publish',
      scheduledAt: null,
      status: 'cancelled',
    })
  })

  it('claimPending returns due rows with limit', async () => {
    const { select, orderBy, limit } = chainableSelect([INTENT])
    const db = { select }

    const claimed = await scheduleIntentsRepository.claimPending(db as unknown as Database, 20)

    expect(claimed).toEqual([INTENT])
    expect(orderBy).toHaveBeenCalledTimes(1)
    expect(limit).toHaveBeenCalledWith(20)
  })

  it('claimPending returns empty on drivers without select', async () => {
    expect(await scheduleIntentsRepository.claimPending({} as Database)).toEqual([])
  })
})

describe('sweepScheduleIntents', () => {
  const env = {
    PUBLISH_SCHEDULER: { idFromName: vi.fn(), get: vi.fn() },
  } as unknown as Env

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function sweepDb(intents: unknown[]) {
    const { select } = chainableSelect(intents)
    const { update } = chainableUpdate([{ id: 'i1' }])
    return { select, update } as unknown as Database
  }

  it('re-notifies a still-scheduled publish intent and marks it done', async () => {
    mockEntriesRepository.findById.mockResolvedValue({
      id: 'e1',
      status: 'scheduled',
      publishAt: '2026-10-20T00:00:00.000Z',
      unpublishAt: null,
    })
    mockSchedulerService.notifySchedule.mockResolvedValue(undefined)

    const result = await sweepScheduleIntents(sweepDb([INTENT]), env)

    expect(result).toEqual({ claimed: 1, notified: 1, cancelled: 0, stale: 0, failed: 0 })
    expect(mockSchedulerService.notifySchedule).toHaveBeenCalledWith(
      env,
      'e1',
      'publish',
      '2026-10-20T00:00:00.000Z',
      { tenantScope: 't1' }
    )
  })

  it('marks rescheduled intents stale without touching the DO', async () => {
    mockEntriesRepository.findById.mockResolvedValue({
      id: 'e1',
      status: 'scheduled',
      publishAt: '2026-10-21T00:00:00.000Z',
      unpublishAt: null,
    })

    const result = await sweepScheduleIntents(sweepDb([INTENT]), env)

    expect(result.stale).toBe(1)
    expect(mockSchedulerService.notifySchedule).not.toHaveBeenCalled()
    expect(mockSchedulerService.cancelSchedule).not.toHaveBeenCalled()
  })

  it('marks intents for deleted entries stale', async () => {
    mockEntriesRepository.findById.mockResolvedValue(undefined)

    const result = await sweepScheduleIntents(sweepDb([INTENT]), env)

    expect(result.stale).toBe(1)
    expect(mockSchedulerService.notifySchedule).not.toHaveBeenCalled()
  })

  it('re-issues DO cancel for cancelled intents (phantom-publish fence)', async () => {
    const cancelled = { ...INTENT, status: 'cancelled', scheduledAt: null }
    mockSchedulerService.cancelSchedule.mockResolvedValue(undefined)

    const result = await sweepScheduleIntents(sweepDb([cancelled]), env)

    expect(result).toEqual({ claimed: 1, notified: 0, cancelled: 1, stale: 0, failed: 0 })
    expect(mockSchedulerService.cancelSchedule).toHaveBeenCalledTimes(2)
  })

  it('keeps failed intents open with backoff and counts them', async () => {
    mockEntriesRepository.findById.mockResolvedValue({
      id: 'e1',
      status: 'scheduled',
      publishAt: '2026-10-20T00:00:00.000Z',
      unpublishAt: null,
    })
    mockSchedulerService.notifySchedule.mockRejectedValue(new Error('DO down'))

    const result = await sweepScheduleIntents(sweepDb([INTENT]), env)

    expect(result.failed).toBe(1)
    expect(result.notified).toBe(0)
  })

  it('returns zero counts without a scheduler binding', async () => {
    const result = await sweepScheduleIntents({} as Database, {} as Env)
    expect(result).toEqual({ claimed: 0, notified: 0, cancelled: 0, stale: 0, failed: 0 })
  })
})
