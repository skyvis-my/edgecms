import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Env } from '@/env'

const mockSweepScheduleIntents = vi.fn()
const mockRelayOutbox = vi.fn()
const mockSweepR2GcOutbox = vi.fn()
const mockBuildMessagesForEvent = vi.fn().mockResolvedValue([])

vi.mock('@/scheduling/schedule-intents.repository', () => ({
  sweepScheduleIntents: mockSweepScheduleIntents,
}))

vi.mock('@/webhooks/outbox-relay', () => ({
  relayOutbox: mockRelayOutbox,
}))

vi.mock('@/webhooks/queue-producer', () => ({
  buildMessagesForEvent: mockBuildMessagesForEvent,
}))

vi.mock('@/assets/r2-gc.repository', () => ({
  sweepR2GcOutbox: mockSweepR2GcOutbox,
}))

vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(() => ({})),
}))

import schedulerWorker from '../../scheduler/worker'

describe('scheduler worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('executes scheduled sweep of intents on cron trigger', async () => {
    mockSweepScheduleIntents.mockResolvedValueOnce({
      claimed: 2,
      notified: 2,
      cancelled: 0,
      stale: 0,
      failed: 0,
    })

    const controller = {
      cron: '*/1 * * * *',
      scheduledTime: Date.now(),
    } as unknown as ScheduledController

    const mockEnv = {
      DB: {},
    } as unknown as Env

    await schedulerWorker.scheduled(controller, mockEnv)

    expect(mockSweepScheduleIntents).toHaveBeenCalledWith(
      expect.anything(),
      mockEnv,
      { limit: 50 }
    )
  })

  it('handles sweep failure gracefully without throwing uncaught error', async () => {
    mockSweepScheduleIntents.mockRejectedValueOnce(new Error('D1 unavailable'))

    const controller = {
      cron: '*/1 * * * *',
      scheduledTime: Date.now(),
    } as unknown as ScheduledController

    const mockEnv = {
      DB: {},
    } as unknown as Env

    // Should not throw
    await expect(schedulerWorker.scheduled(controller, mockEnv)).resolves.toBeUndefined()
  })

  it('exits safely when DB binding is missing from env', async () => {
    const controller = {
      cron: '*/1 * * * *',
      scheduledTime: Date.now(),
    } as unknown as ScheduledController

    const mockEnv = {} as unknown as Env

    await expect(schedulerWorker.scheduled(controller, mockEnv)).resolves.toBeUndefined()
    expect(mockSweepScheduleIntents).not.toHaveBeenCalled()
  })

  it('executes outbox relay sweep when WEBHOOK_QUEUE is bound', async () => {
    mockRelayOutbox.mockResolvedValueOnce({ relayed: 3, pending: 0 })

    const controller = {
      cron: '*/1 * * * *',
      scheduledTime: Date.now(),
    } as unknown as ScheduledController

    const mockEnv = {
      DB: {},
      WEBHOOK_QUEUE: { sendBatch: vi.fn() },
    } as unknown as Env

    await schedulerWorker.scheduled(controller, mockEnv)

    expect(mockRelayOutbox).toHaveBeenCalledWith(
      expect.anything(),
      mockEnv.WEBHOOK_QUEUE,
      expect.any(Function)
    )

    const resolver = mockRelayOutbox.mock.calls[0]?.[2]
    const dummyEvent = { id: 'evt-1', event: 'entry.created', timestamp: '', data: {} }
    await resolver(dummyEvent)
    expect(mockBuildMessagesForEvent).toHaveBeenCalledWith(expect.anything(), dummyEvent)
  })

  it('executes R2 GC sweep when MEDIA is bound', async () => {
    mockSweepR2GcOutbox.mockResolvedValueOnce({ deleted: 5, failed: 0 })

    const controller = {
      cron: '*/1 * * * *',
      scheduledTime: Date.now(),
    } as unknown as ScheduledController

    const mockEnv = {
      DB: {},
      MEDIA: { delete: vi.fn() },
    } as unknown as Env

    await schedulerWorker.scheduled(controller, mockEnv)

    expect(mockSweepR2GcOutbox).toHaveBeenCalledWith(
      expect.anything(),
      mockEnv.MEDIA
    )
  })

  it('skips outbox relay and R2 GC sweeps when bindings are missing', async () => {
    mockSweepScheduleIntents.mockResolvedValueOnce({
      claimed: 0,
      notified: 0,
      cancelled: 0,
      stale: 0,
      failed: 0,
    })

    const controller = {
      cron: '*/1 * * * *',
      scheduledTime: Date.now(),
    } as unknown as ScheduledController

    const mockEnv = {
      DB: {},
    } as unknown as Env

    await schedulerWorker.scheduled(controller, mockEnv)

    expect(mockRelayOutbox).not.toHaveBeenCalled()
    expect(mockSweepR2GcOutbox).not.toHaveBeenCalled()
  })

  it('handles outbox relay and R2 GC failures gracefully without throwing', async () => {
    mockRelayOutbox.mockRejectedValueOnce(new Error('Queue unavailable'))
    mockSweepR2GcOutbox.mockRejectedValueOnce(new Error('R2 unavailable'))

    const controller = {
      cron: '*/1 * * * *',
      scheduledTime: Date.now(),
    } as unknown as ScheduledController

    const mockEnv = {
      DB: {},
      WEBHOOK_QUEUE: { sendBatch: vi.fn() },
      MEDIA: { delete: vi.fn() },
    } as unknown as Env

    await expect(schedulerWorker.scheduled(controller, mockEnv)).resolves.toBeUndefined()
  })

  it('returns healthy status on HTTP fetch request', async () => {
    const req = new Request('http://localhost/health')
    const res = await schedulerWorker.fetch(req, {} as Env)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ status: 'ok', worker: 'edgecms-scheduler' })
  })
})
