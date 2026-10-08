import { create } from 'zustand'
import { db } from './local-db'
import { logger } from '@/lib/logger'

/**
 * Sync status state machine
 * - idle: Not currently syncing
 * - syncing: Active sync in progress
 * - error: Last sync attempt failed
 * - offline: Network is offline
 */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline'

/**
 * Sync state store for UI components
 *
 * Tracks sync status, last sync time, and counts for pending/conflicted commands.
 * Used by the sync indicator UI and conflict resolution screens.
 */
interface SyncStore {
  status: SyncStatus
  lastSyncAt: string | null
  conflictCount: number
  pendingCount: number
  schemaSnapshotCount: number
  error: string | null

  // Actions
  setStatus: (status: SyncStatus) => void
  setLastSyncAt: (date: string) => void
  setConflictCount: (count: number) => void
  setPendingCount: (count: number) => void
  setSchemaSnapshotCount: (count: number) => void
  setError: (error: string | null) => void
  refreshCounts: () => Promise<void>
}

/**
 * Zustand store for sync state management
 */
export const useSyncStore = create<SyncStore>((set) => ({
  status: 'idle',
  lastSyncAt: null,
  conflictCount: 0,
  pendingCount: 0,
  schemaSnapshotCount: 0,
  error: null,

  setStatus: (status) => set({ status }),

  setLastSyncAt: (date) => set({ lastSyncAt: date }),

  setConflictCount: (count) => set({ conflictCount: count }),

  setPendingCount: (count) => set({ pendingCount: count }),
  setSchemaSnapshotCount: (count) => set({ schemaSnapshotCount: count }),

  setError: (error) => set({ error }),

  /**
   * Query Dexie for current pending and conflicted command counts
   */
  refreshCounts: async () => {
    try {
      const [pendingCount, conflictCount, schemaSnapshotCount] = await Promise.all([
        db.commandQueue.where('status').equals('pending').count(),
        db.commandQueue.where('status').equals('conflicted').count(),
        db.schemaSnapshots.count(),
      ])

      set({ pendingCount, conflictCount, schemaSnapshotCount })
    } catch (error) {
      logger.error('Failed to refresh sync counts:', error)
    }
  },
}))
