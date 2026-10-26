import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Env } from '@/env'

const mockSweepScheduleIntents = vi.fn()

vi.mock('@/scheduling/schedule-intents.repository', () => ({
  sweepScheduleIntents: mockSweepScheduleIntents,
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

  it('returns healthy status on HTTP fetch request', async () => {
    const req = new Request('http://localhost/health')
    const res = await schedulerWorker.fetch(req, {} as Env)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ status: 'ok', worker: 'edgecms-scheduler' })
  })
})
