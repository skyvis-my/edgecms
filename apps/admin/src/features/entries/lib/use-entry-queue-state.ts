import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/features/sync/local-db'
import { getCurrentTenantSlug } from '@/lib/tenant-storage'
import { logger } from '@/lib/logger'
import { type EntryQueueState, groupQueueByEntry } from './entry-status'

const EMPTY = new Map<string, EntryQueueState>()

/**
 * Live map of entry id -> unsynced command counts from the offline command queue (OF-02).
 * Re-renders when the queue changes (enqueue, replay, conflict).
 */
export function useEntryQueueState(): Map<string, EntryQueueState> {
  const map = useLiveQuery(
    async () => {
      try {
        const items = await db.commandQueue
          .where('status')
          .anyOf('pending', 'syncing', 'conflicted')
          .toArray()
        return groupQueueByEntry(items, getCurrentTenantSlug())
      } catch (error) {
        logger.warn('Failed to read offline command queue for entry status:', error)
        return EMPTY
      }
    },
    [],
    EMPTY
  )
  return map ?? EMPTY
}
