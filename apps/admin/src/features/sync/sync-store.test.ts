import { beforeEach, describe, expect, it, vi } from 'bun:test'

// Mock the local-db module so Dexie is never actually instantiated
vi.mock('./local-db', () => ({
  db: {
    commandQueue: {
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(0),
        }),
      }),
    },
    collections: { toArray: vi.fn(), put: vi.fn(), bulkPut: vi.fn() },
    entries: { toArray: vi.fn(), put: vi.fn(), bulkPut: vi.fn() },
    schemaSnapshots: { count: vi.fn().mockResolvedValue(0) },
    relations: { toArray: vi.fn(), put: vi.fn(), bulkPut: vi.fn() },
    syncState: { get: vi.fn(), put: vi.fn() },
    transaction: vi.fn(),
  },
}))

const { useSyncStore } = await import(`./sync-store?bypass=${Date.now()}`)

describe('SyncStore', () => {
  beforeEach(() => {
    // Reset the store to its initial state before each test
    useSyncStore.setState({
      status: 'idle',
      lastSyncAt: null,
      conflictCount: 0,
      pendingCount: 0,
      schemaSnapshotCount: 0,
      error: null,
    })
  })

  describe('initial state', () => {
    it('has idle status', () => {
      expect(useSyncStore.getState().status).toBe('idle')
    })

    it('has null lastSyncAt', () => {
      expect(useSyncStore.getState().lastSyncAt).toBeNull()
    })

    it('has zero conflict count', () => {
      expect(useSyncStore.getState().conflictCount).toBe(0)
    })

    it('has zero pending count', () => {
      expect(useSyncStore.getState().pendingCount).toBe(0)
    })

    it('has null error', () => {
      expect(useSyncStore.getState().error).toBeNull()
    })
  })

  describe('setStatus', () => {
    it('changes status to syncing', () => {
      useSyncStore.getState().setStatus('syncing')
      expect(useSyncStore.getState().status).toBe('syncing')
    })

    it('changes status to error', () => {
      useSyncStore.getState().setStatus('error')
      expect(useSyncStore.getState().status).toBe('error')
    })

    it('changes status to offline', () => {
      useSyncStore.getState().setStatus('offline')
      expect(useSyncStore.getState().status).toBe('offline')
    })

    it('changes status back to idle', () => {
      useSyncStore.getState().setStatus('syncing')
      useSyncStore.getState().setStatus('idle')
      expect(useSyncStore.getState().status).toBe('idle')
    })
  })

  describe('setLastSyncAt', () => {
    it('updates the timestamp', () => {
      useSyncStore.getState().setLastSyncAt('2026-01-15T10:00:00.000Z')
      expect(useSyncStore.getState().lastSyncAt).toBe('2026-01-15T10:00:00.000Z')
    })
  })

  describe('setConflictCount', () => {
    it('updates the conflict count', () => {
      useSyncStore.getState().setConflictCount(5)
      expect(useSyncStore.getState().conflictCount).toBe(5)
    })
  })

  describe('setPendingCount', () => {
    it('updates the pending count', () => {
      useSyncStore.getState().setPendingCount(12)
      expect(useSyncStore.getState().pendingCount).toBe(12)
    })
  })

  describe('setError', () => {
    it('sets an error message', () => {
      useSyncStore.getState().setError('Network failed')
      expect(useSyncStore.getState().error).toBe('Network failed')
    })

    it('clears error when set to null', () => {
      useSyncStore.getState().setError('Some error')
      useSyncStore.getState().setError(null)
      expect(useSyncStore.getState().error).toBeNull()
    })
  })

  describe('refreshCounts', () => {
    it('queries Dexie and updates pending and conflict counts', async () => {
      const { db } = await import('./local-db')

      const pendingCountMock = vi.fn().mockResolvedValue(3)
      const conflictCountMock = vi.fn().mockResolvedValue(2)
      db.schemaSnapshots.count.mockResolvedValue(1)

      db.commandQueue.where.mockImplementation((field: string) => {
        return {
          equals: (value: string) => {
            if (field === 'status' && value === 'pending') {
              return { count: pendingCountMock }
            }
            if (field === 'status' && value === 'conflicted') {
              return { count: conflictCountMock }
            }
            return { count: vi.fn().mockResolvedValue(0) }
          },
        } as never
      })

      await useSyncStore.getState().refreshCounts()

      expect(useSyncStore.getState().pendingCount).toBe(3)
      expect(useSyncStore.getState().conflictCount).toBe(2)
      expect(useSyncStore.getState().schemaSnapshotCount).toBe(1)
    })

    it('handles errors gracefully without throwing', async () => {
      const { db } = await import('./local-db')

      db.commandQueue.where.mockImplementation(() => {
        throw new Error('DB error')
      })

      // Should not throw
      await useSyncStore.getState().refreshCounts()

      // Counts should remain at previous values
      expect(useSyncStore.getState().pendingCount).toBe(0)
      expect(useSyncStore.getState().conflictCount).toBe(0)
    })
  })
})
