import { describe, expect, it, vi } from 'bun:test'
import {
  buildSyncPullPayload,
  executeSyncPushCommands,
  MAX_SYNC_PULL_LIMIT,
  normalizeSyncPullLimit,
} from '../../sync/sync.service'

describe('sync.service', () => {
  describe('normalizeSyncPullLimit', () => {
    it('defaults to 100 when limit is missing', () => {
      expect(normalizeSyncPullLimit(undefined)).toBe(100)
    })

    it('enforces hard upper bound', () => {
      expect(normalizeSyncPullLimit(999)).toBe(MAX_SYNC_PULL_LIMIT)
    })
  })

  describe('buildSyncPullPayload', () => {
    it('returns cursor from last change when records exist', () => {
      const payload = buildSyncPullPayload(
        [
          {
            sequence: 2,
            id: 'c2',
            entityType: 'entry',
            entityId: 'e2',
            commandId: 'cmd2',
            changeType: 'update',
            payload: {},
            timestamp: 't2',
          },
          {
            sequence: 3,
            id: 'c3',
            entityType: 'entry',
            entityId: 'e3',
            commandId: 'cmd3',
            changeType: 'update',
            payload: {},
            timestamp: 't3',
          },
        ],
        1,
        10
      )

      expect(payload.cursor).toBe(3)
      expect(payload.hasMore).toBe(false)
      expect(payload.changes).toHaveLength(2)
    })

    it('sets hasMore and trims records when results exceed limit', () => {
      const payload = buildSyncPullPayload(
        [
          {
            sequence: 1,
            id: 'c1',
            entityType: 'entry',
            entityId: 'e1',
            commandId: 'cmd1',
            changeType: 'create',
            payload: {},
            timestamp: 't1',
          },
          {
            sequence: 2,
            id: 'c2',
            entityType: 'entry',
            entityId: 'e2',
            commandId: 'cmd2',
            changeType: 'update',
            payload: {},
            timestamp: 't2',
          },
        ],
        0,
        1
      )

      expect(payload.hasMore).toBe(true)
      expect(payload.changes).toHaveLength(1)
      expect(payload.cursor).toBe(1)
    })

    it('keeps existing cursor when no changes are returned', () => {
      const payload = buildSyncPullPayload([], 42, 100)
      expect(payload.cursor).toBe(42)
      expect(payload.hasMore).toBe(false)
    })
  })

  describe('executeSyncPushCommands', () => {
    it('maps success, conflict, and failure states in order', async () => {
      const executeCommandFn = vi
        .fn()
        .mockResolvedValueOnce({
          commandId: 'c1',
          type: 'createEntry',
          status: 'success',
          data: { id: 'e1' },
          executedAt: new Date().toISOString(),
        })
        .mockResolvedValueOnce({
          commandId: 'c2',
          type: 'updateEntry',
          status: 'failed',
          error: { code: 'VERSION_CONFLICT', message: 'conflict' },
          executedAt: new Date().toISOString(),
        })
        .mockResolvedValueOnce({
          commandId: 'c3',
          type: 'deleteEntry',
          status: 'failed',
          error: { code: 'NOT_FOUND', message: 'missing' },
          executedAt: new Date().toISOString(),
        })

      const findEntryByIdFn = vi.fn().mockResolvedValue({ id: 'e1', version: 9 })

      const results = await executeSyncPushCommands({
        commands: [
          { type: 'createEntry', payload: {} },
          { type: 'updateEntry', payload: { entryId: 'e1', data: { title: 'next' } } },
          { type: 'deleteEntry', payload: { entryId: 'e2' } },
        ],
        userId: 'u1',
        db: {} as never,
        kv: {} as KVNamespace,
        syncChannel: 'tenant-1',
        executeCommandFn,
        findEntryByIdFn,
      })

      expect(results).toHaveLength(3)
      expect(results[0]).toEqual(
        expect.objectContaining({
          index: 0,
          status: 'success',
          data: { id: 'e1' },
        })
      )
      expect(results[1]).toEqual(
        expect.objectContaining({
          index: 1,
          status: 'conflict',
          serverState: expect.objectContaining({
            version: 9,
            conflictingFields: ['title'],
          }),
        })
      )
      expect(results[2]).toEqual(
        expect.objectContaining({
          index: 2,
          status: 'failed',
          error: { code: 'NOT_FOUND', message: 'missing' },
        })
      )

      expect(executeCommandFn).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          actor: { userId: 'u1', source: 'sync' },
          syncChannel: 'tenant-1',
        }),
        expect.objectContaining({
          actor: { userId: 'u1', source: 'sync' },
        })
      )
      expect(findEntryByIdFn).toHaveBeenCalledTimes(1)
    })

    it('converts thrown command errors into INTERNAL_ERROR failures', async () => {
      const results = await executeSyncPushCommands({
        commands: [{ type: 'createEntry', payload: {} }],
        userId: 'u1',
        db: {} as never,
        kv: {} as KVNamespace,
        syncChannel: 'global',
        executeCommandFn: vi.fn().mockRejectedValue(new Error('boom')),
        findEntryByIdFn: vi.fn(),
      })

      expect(results).toEqual([
        {
          index: 0,
          status: 'failed',
          error: { code: 'INTERNAL_ERROR', message: 'boom' },
        },
      ])
    })
  })
})
