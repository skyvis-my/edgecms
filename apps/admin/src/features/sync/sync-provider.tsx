import { useEffect } from 'react'
import { startSyncScheduler, stopSyncScheduler } from './sync-scheduler'
import { useSyncStore } from './sync-store'
import { logger } from '@/lib/logger'

/**
 * Sync Provider Component
 *
 * Manages the sync lifecycle for the authenticated app:
 * - Starts sync scheduler on mount
 * - Stops sync scheduler on unmount
 * - Monitors online/offline status
 * - Refreshes sync counts on mount
 *
 * Should be mounted once in the authenticated layout tree.
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const refreshCounts = useSyncStore((state) => state.refreshCounts)
  const setStatus = useSyncStore((state) => state.setStatus)

  useEffect(() => {
    logger.info('SyncProvider: Initializing sync engine')

    // Set initial online/offline status
    if (!navigator.onLine) {
      setStatus('offline')
    }

    // Refresh counts to show initial state
    refreshCounts().catch((error) => {
      logger.error('Failed to refresh initial sync counts:', error)
    })

    // Start the sync scheduler
    startSyncScheduler()

    // Cleanup on unmount
    return () => {
      logger.info('SyncProvider: Stopping sync engine')
      stopSyncScheduler()
    }
  }, [refreshCounts, setStatus])

  return <>{children}</>
}
