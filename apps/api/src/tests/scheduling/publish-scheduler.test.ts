/**
 * Tests for PublishScheduler Durable Object
 *
 * Tests the alarm-based scheduling logic, queue management,
 * and command execution for publish/unpublish transitions.
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Env } from '@/env'
import { createMockEnv } from '../../../test-utils/mock-env'
import { type PendingTransition, PublishScheduler } from '../../scheduling/publish-scheduler.do'

// Mock the command engine module
vi.mock('@/commands/engine', () => ({
  executeCommand: vi.fn().mockResolvedValue({
    commandId: 'test-command-id',
    type: 'publishNow',
    status: 'success',
    executedAt: new Date().toISOString(),
  }),
}))

const incrementVersion = vi.fn(
  async (kv: KVNamespace, collectionSlug: string, locale: string, tenantScope?: string) => {
    const key = tenantScope
      ? `${tenantScope}:version:${collectionSlug}:${locale}`
      : `version:${collectionSlug}:${locale}`
    const current = await kv.get(key)
    const next = (current ? Number.parseInt(current, 10) : 1) + 1
    await kv.put(key, String(next))
    return next
  }
)

vi.mock('@/cache/kv.service', () => ({
  kvService: {
    incrementVersion,
    getCurrentVersion: vi.fn().mockResolvedValue(1),
    getVersionedKey: vi.fn((baseKey: string, version: number, tenantScope?: string) =>
      tenantScope ? `${tenantScope}:v${version}:${baseKey}` : `v${version}:${baseKey}`
    ),
    getSnapshot: vi.fn().mockResolvedValue(null),
    putSnapshot: vi.fn().mockResolvedValue(undefined),
    deleteSnapshot: vi.fn().mockResolvedValue(undefined),
    __resetInMemorySnapshotCacheForTests: vi.fn(),
  },
}))

/**
 * Mock DurableObjectState for testing
 */
class MockDurableObjectState {
  private internalStorage = new Map<string, unknown>()
  private alarmTime: number | null = null

  id: DurableObjectId = { toString: () => 'test-id', equals: () => false } as DurableObjectId
  blockConcurrencyWhile = vi.fn().mockImplementation(async (callback: () => Promise<void>) => {
    await callback()
  })

  waitUntil = vi.fn()
  abort = vi.fn()

  storage: DurableObjectState['storage']

  constructor() {
    // Create storage API that references internal storage
    this.storage = {
      get: vi.fn().mockImplementation(async (key: string) => {
        return this.internalStorage.get(key)
      }),
      put: vi.fn().mockImplementation(async (key: string, value: unknown) => {
        this.internalStorage.set(key, value)
      }),
      delete: vi.fn().mockImplementation(async (key: string) => {
        this.internalStorage.delete(key)
      }),
      deleteAlarm: vi.fn().mockImplementation(async () => {
        this.alarmTime = null
      }),
      setAlarm: vi.fn().mockImplementation(async (time: number) => {
        this.alarmTime = time
      }),
      getAlarm: vi.fn().mockImplementation(async () => {
        return this.alarmTime
      }),
      deleteAll: vi.fn(),
      transaction: vi.fn(),
      list: vi.fn(),
    } as unknown as DurableObjectState['storage']
  }

  getAlarmTime(): number | null {
    return this.alarmTime
  }

  getStorageValue<T>(key: string): T | undefined {
    return this.internalStorage.get(key) as T | undefined
  }
}

describe('PublishScheduler Durable Object', () => {
  let mockState: MockDurableObjectState
  let mockEnv: Env
  let scheduler: PublishScheduler

  beforeEach(async () => {
    vi.clearAllMocks()
    incrementVersion.mockClear()
    mockState = new MockDurableObjectState()
    mockEnv = createMockEnv()
    scheduler = new PublishScheduler(mockState as unknown as DurableObjectState, mockEnv)
  })

  describe('addPendingTransition', () => {
    it('should add a transition to the queue', async () => {
      const entryId = 'entry-1'
      const scheduledAt = new Date(Date.now() + 60000).toISOString() // 1 minute from now

      await scheduler.addPendingTransition(entryId, 'publish', scheduledAt)

      const queue = mockState.getStorageValue<PendingTransition[]>('pending_transitions')
      expect(queue).toHaveLength(1)
      expect(queue?.[0]).toEqual({
        entryId,
        transitionType: 'publish',
        scheduledAt,
      })
    })

    it('should maintain sorted order by scheduledAt', async () => {
      const now = Date.now()
      const scheduledAt1 = new Date(now + 120000).toISOString() // 2 minutes
      const scheduledAt2 = new Date(now + 60000).toISOString() // 1 minute
      const scheduledAt3 = new Date(now + 180000).toISOString() // 3 minutes

      await scheduler.addPendingTransition('entry-1', 'publish', scheduledAt1)
      await scheduler.addPendingTransition('entry-2', 'publish', scheduledAt2)
      await scheduler.addPendingTransition('entry-3', 'publish', scheduledAt3)

      const queue = mockState.getStorageValue<PendingTransition[]>('pending_transitions')
      expect(queue).toHaveLength(3)
      expect(queue?.[0]?.entryId).toBe('entry-2') // earliest
      expect(queue?.[1]?.entryId).toBe('entry-1')
      expect(queue?.[2]?.entryId).toBe('entry-3') // latest
    })

    it('should replace existing transition for same entry and type', async () => {
      const entryId = 'entry-1'
      const scheduledAt1 = new Date(Date.now() + 60000).toISOString()
      const scheduledAt2 = new Date(Date.now() + 120000).toISOString()

      await scheduler.addPendingTransition(entryId, 'publish', scheduledAt1)
      await scheduler.addPendingTransition(entryId, 'publish', scheduledAt2)

      const queue = mockState.getStorageValue<PendingTransition[]>('pending_transitions')
      expect(queue).toHaveLength(1)
      expect(queue?.[0]?.scheduledAt).toBe(scheduledAt2)
    })

    it('should allow different transition types for same entry', async () => {
      const entryId = 'entry-1'
      const publishAt = new Date(Date.now() + 60000).toISOString()
      const unpublishAt = new Date(Date.now() + 120000).toISOString()

      await scheduler.addPendingTransition(entryId, 'publish', publishAt)
      await scheduler.addPendingTransition(entryId, 'unpublish', unpublishAt)

      const queue = mockState.getStorageValue<PendingTransition[]>('pending_transitions')
      expect(queue).toHaveLength(2)
      expect(queue?.find((t) => t.transitionType === 'publish')).toBeDefined()
      expect(queue?.find((t) => t.transitionType === 'unpublish')).toBeDefined()
    })

    it('should set alarm for the earliest transition', async () => {
      const now = Date.now()
      const scheduledAt = new Date(now + 60000).toISOString()

      await scheduler.addPendingTransition('entry-1', 'publish', scheduledAt)

      const alarmTime = mockState.getAlarmTime()
      expect(alarmTime).toBe(new Date(scheduledAt).getTime())
    })

    it('should update alarm when new earliest transition is added', async () => {
      const now = Date.now()
      const scheduledAt1 = new Date(now + 120000).toISOString()
      const scheduledAt2 = new Date(now + 60000).toISOString() // earlier

      await scheduler.addPendingTransition('entry-1', 'publish', scheduledAt1)
      const alarmTime1 = mockState.getAlarmTime()

      await scheduler.addPendingTransition('entry-2', 'publish', scheduledAt2)
      const alarmTime2 = mockState.getAlarmTime()

      expect(alarmTime1).toBe(new Date(scheduledAt1).getTime())
      expect(alarmTime2).toBe(new Date(scheduledAt2).getTime())
      expect(alarmTime1).not.toBeNull()
      expect(alarmTime2).not.toBeNull()
      expect(alarmTime2).toBeLessThan(alarmTime1 as number)
    })
  })

  describe('removePendingTransition', () => {
    it('should remove a transition from the queue', async () => {
      const entryId = 'entry-1'
      const scheduledAt = new Date(Date.now() + 60000).toISOString()

      await scheduler.addPendingTransition(entryId, 'publish', scheduledAt)
      await scheduler.removePendingTransition(entryId, 'publish')

      const queue = mockState.getStorageValue<PendingTransition[]>('pending_transitions')
      expect(queue).toHaveLength(0)
    })

    it('should only remove matching entry and type', async () => {
      const entryId = 'entry-1'
      const publishAt = new Date(Date.now() + 60000).toISOString()
      const unpublishAt = new Date(Date.now() + 120000).toISOString()

      await scheduler.addPendingTransition(entryId, 'publish', publishAt)
      await scheduler.addPendingTransition(entryId, 'unpublish', unpublishAt)
      await scheduler.removePendingTransition(entryId, 'publish')

      const queue = mockState.getStorageValue<PendingTransition[]>('pending_transitions')
      expect(queue).toHaveLength(1)
      expect(queue?.[0]?.transitionType).toBe('unpublish')
    })

    it('should delete alarm when queue becomes empty', async () => {
      const entryId = 'entry-1'
      const scheduledAt = new Date(Date.now() + 60000).toISOString()

      await scheduler.addPendingTransition(entryId, 'publish', scheduledAt)
      expect(mockState.getAlarmTime()).not.toBeNull()

      await scheduler.removePendingTransition(entryId, 'publish')
      expect(mockState.getAlarmTime()).toBeNull()
    })

    it('should update alarm when earliest transition is removed', async () => {
      const now = Date.now()
      const scheduledAt1 = new Date(now + 60000).toISOString() // earliest
      const scheduledAt2 = new Date(now + 120000).toISOString()

      await scheduler.addPendingTransition('entry-1', 'publish', scheduledAt1)
      await scheduler.addPendingTransition('entry-2', 'publish', scheduledAt2)

      await scheduler.removePendingTransition('entry-1', 'publish')

      const alarmTime = mockState.getAlarmTime()
      expect(alarmTime).toBe(new Date(scheduledAt2).getTime())
    })
  })

  describe('alarm', () => {
    it('bumps KV version even when no cache tags exist', async () => {
      const now = Date.now()
      const pastTime = new Date(now - 60000).toISOString()

      await scheduler.addPendingTransition('entry-1', 'publish', pastTime, {
        collectionSlug: 'posts',
        locales: ['en'],
      })

      await scheduler.alarm()

      expect(mockEnv.CACHE.put).toHaveBeenCalledWith(
        expect.stringContaining('version:posts:en'),
        expect.any(String)
      )
    })

    it('should process all due transitions', async () => {
      const { executeCommand } = await import('@/commands/engine')

      const now = Date.now()
      const pastTime1 = new Date(now - 60000).toISOString() // 1 minute ago
      const pastTime2 = new Date(now - 30000).toISOString() // 30 seconds ago
      const futureTime = new Date(now + 60000).toISOString() // 1 minute from now

      await scheduler.addPendingTransition('entry-1', 'publish', pastTime1)
      await scheduler.addPendingTransition('entry-2', 'unpublish', pastTime2)
      await scheduler.addPendingTransition('entry-3', 'publish', futureTime)

      await scheduler.alarm()

      // Should execute commands for past transitions
      expect(executeCommand).toHaveBeenCalledTimes(2)
      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: { userId: 'system', source: 'scheduler' },
        }),
        expect.objectContaining({
          type: 'publishNow',
          payload: { entryId: 'entry-1' },
        })
      )
      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: { userId: 'system', source: 'scheduler' },
        }),
        expect.objectContaining({
          type: 'unpublishNow',
          payload: { entryId: 'entry-2' },
        })
      )
    })

    it('should remove processed transitions from queue', async () => {
      const now = Date.now()
      const pastTime = new Date(now - 60000).toISOString()
      const futureTime = new Date(now + 60000).toISOString()

      await scheduler.addPendingTransition('entry-1', 'publish', pastTime)
      await scheduler.addPendingTransition('entry-2', 'publish', futureTime)

      await scheduler.alarm()

      const queue = mockState.getStorageValue<PendingTransition[]>('pending_transitions')
      expect(queue).toHaveLength(1)
      expect(queue?.[0]?.entryId).toBe('entry-2')
    })

    it('should chain alarm for next pending transition', async () => {
      const now = Date.now()
      const pastTime = new Date(now - 60000).toISOString()
      const futureTime = new Date(now + 60000).toISOString()

      await scheduler.addPendingTransition('entry-1', 'publish', pastTime)
      await scheduler.addPendingTransition('entry-2', 'publish', futureTime)

      await scheduler.alarm()

      const alarmTime = mockState.getAlarmTime()
      expect(alarmTime).toBe(new Date(futureTime).getTime())
    })

    it('should delete alarm when no more pending transitions', async () => {
      const pastTime = new Date(Date.now() - 60000).toISOString()

      await scheduler.addPendingTransition('entry-1', 'publish', pastTime)
      await scheduler.alarm()

      const alarmTime = mockState.getAlarmTime()
      expect(alarmTime).toBeNull()
    })

    it('should handle multiple transitions at same time', async () => {
      const { executeCommand } = await import('@/commands/engine')

      const pastTime = new Date(Date.now() - 60000).toISOString()

      await scheduler.addPendingTransition('entry-1', 'publish', pastTime)
      await scheduler.addPendingTransition('entry-2', 'publish', pastTime)
      await scheduler.addPendingTransition('entry-3', 'unpublish', pastTime)

      await scheduler.alarm()

      expect(executeCommand).toHaveBeenCalledTimes(3)

      const queue = mockState.getStorageValue<PendingTransition[]>('pending_transitions')
      expect(queue).toHaveLength(0)
    })

    it('should continue processing even if one transition fails', async () => {
      const { executeCommand } = await import('@/commands/engine')
      const mockExecuteCommand = executeCommand as unknown as ReturnType<typeof vi.fn>
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Mock executeCommand to fail for the first call
      mockExecuteCommand
        .mockRejectedValueOnce(new Error('Command execution failed'))
        .mockResolvedValueOnce({
          commandId: 'test-command-id',
          type: 'publishNow',
          status: 'success',
          executedAt: new Date().toISOString(),
        })

      const pastTime = new Date(Date.now() - 60000).toISOString()

      await scheduler.addPendingTransition('entry-1', 'publish', pastTime)
      await scheduler.addPendingTransition('entry-2', 'publish', pastTime)

      await scheduler.alarm()

      // Should have attempted both executions
      expect(executeCommand).toHaveBeenCalledTimes(2)

      // Should have logged the error
      expect(consoleSpy).toHaveBeenCalledWith(
        'scheduler_transition_failed',
        expect.objectContaining({
          entryId: 'entry-1',
          error: 'Command execution failed',
        })
      )

      consoleSpy.mockRestore()
    })
  })

  describe('fetch', () => {
    it('should handle /add endpoint', async () => {
      const request = new Request('http://internal/add', {
        method: 'POST',
        body: JSON.stringify({
          entryId: 'entry-1',
          transitionType: 'publish',
          scheduledAt: new Date(Date.now() + 60000).toISOString(),
        }),
      })

      const response = await scheduler.fetch(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ success: true })

      const queue = mockState.getStorageValue<PendingTransition[]>('pending_transitions')
      expect(queue).toHaveLength(1)
    })

    it('should handle /remove endpoint', async () => {
      const scheduledAt = new Date(Date.now() + 60000).toISOString()
      await scheduler.addPendingTransition('entry-1', 'publish', scheduledAt)

      const request = new Request('http://internal/remove', {
        method: 'POST',
        body: JSON.stringify({
          entryId: 'entry-1',
          transitionType: 'publish',
        }),
      })

      const response = await scheduler.fetch(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({ success: true })

      const queue = mockState.getStorageValue<PendingTransition[]>('pending_transitions')
      expect(queue).toHaveLength(0)
    })

    it('should handle /queue endpoint', async () => {
      const scheduledAt = new Date(Date.now() + 60000).toISOString()
      await scheduler.addPendingTransition('entry-1', 'publish', scheduledAt)

      const request = new Request('http://internal/queue', {
        method: 'GET',
      })

      const response = await scheduler.fetch(request)
      const data = (await response.json()) as { queue: PendingTransition[] }

      expect(response.status).toBe(200)
      expect(data.queue).toHaveLength(1)
      expect(data.queue[0]?.entryId).toBe('entry-1')
    })

    it('should return 404 for unknown endpoints', async () => {
      const request = new Request('http://internal/unknown', {
        method: 'GET',
      })

      const response = await scheduler.fetch(request)

      expect(response.status).toBe(404)
    })
  })
})
