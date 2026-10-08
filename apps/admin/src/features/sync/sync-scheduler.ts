import { resolveApiBasePath } from '@/lib/api-base-path'
import { getCurrentTenantSlug } from '@/lib/tenant-storage'
import { prefixTenantPath } from '@/lib/tenant-path'
import { db } from './local-db'
import { sync } from './sync-engine'
import { useSyncStore } from './sync-store'
import { logger } from '@/lib/logger'

/**
 * Sync scheduler state
 */
let syncInterval: ReturnType<typeof setInterval> | null = null
let syncEventSource: EventSource | null = null
let syncEventReconnectTimeout: ReturnType<typeof setTimeout> | null = null
let syncEventDebounceTimeout: ReturnType<typeof setTimeout> | null = null
let initialSyncTimeout: ReturnType<typeof setTimeout> | null = null
let isOnlineListenerAttached = false
let currentBackoffDelay = 1000 // Start at 1 second
const MAX_BACKOFF_DELAY = 60000 // Max 60 seconds
const DEFAULT_SYNC_INTERVAL = 30000 // 30 seconds
const SSE_DEBOUNCE_MS = 300
const SSE_INITIAL_RECONNECT_DELAY = 1000
const SSE_MAX_RECONNECT_DELAY = 30000
let currentSseReconnectDelay = SSE_INITIAL_RECONNECT_DELAY

function getSyncStreamUrl(): string {
  const tenantPath = prefixTenantPath('/admin/sync/stream', getCurrentTenantSlug())
  return `${resolveApiBasePath()}${tenantPath}`
}

function clearSyncEventReconnectTimeout() {
  if (syncEventReconnectTimeout !== null) {
    clearTimeout(syncEventReconnectTimeout)
    syncEventReconnectTimeout = null
  }
}

function clearSyncEventDebounceTimeout() {
  if (syncEventDebounceTimeout !== null) {
    clearTimeout(syncEventDebounceTimeout)
    syncEventDebounceTimeout = null
  }
}

function clearInitialSyncTimeout() {
  if (initialSyncTimeout !== null) {
    clearTimeout(initialSyncTimeout)
    initialSyncTimeout = null
  }
}

function closeSyncEventSource() {
  if (syncEventSource !== null) {
    syncEventSource.close()
    syncEventSource = null
  }
}

function scheduleSyncFromEvent() {
  if (syncEventDebounceTimeout !== null) return

  syncEventDebounceTimeout = setTimeout(() => {
    syncEventDebounceTimeout = null
    if (!navigator.onLine) return
    triggerSync().catch((error) => {
      logger.error('Sync failed after SSE change event:', error)
    })
  }, SSE_DEBOUNCE_MS)
}

function scheduleSseReconnect() {
  if (syncInterval === null || !navigator.onLine) return
  if (syncEventReconnectTimeout !== null) return

  syncEventReconnectTimeout = setTimeout(() => {
    syncEventReconnectTimeout = null
    startSyncEventStream()
  }, currentSseReconnectDelay)

  currentSseReconnectDelay = Math.min(currentSseReconnectDelay * 2, SSE_MAX_RECONNECT_DELAY)
}

function startSyncEventStream() {
  if (typeof EventSource === 'undefined') return
  if (syncEventSource !== null) return

  clearSyncEventReconnectTimeout()
  const source = new EventSource(getSyncStreamUrl(), { withCredentials: true })
  syncEventSource = source

  source.addEventListener('change', scheduleSyncFromEvent as EventListener)

  source.addEventListener('connected', () => {
    currentSseReconnectDelay = SSE_INITIAL_RECONNECT_DELAY
  })

  source.onerror = () => {
    if (syncEventSource !== source) {
      return
    }
    closeSyncEventSource()
    scheduleSseReconnect()
  }
}

/**
 * Execute a sync operation with error handling and state updates
 */
async function executeSyncWithStateUpdates(): Promise<void> {
  const store = useSyncStore.getState()

  // Don't sync if already syncing or offline
  if (store.status === 'syncing' || store.status === 'offline') {
    return
  }

  try {
    store.setStatus('syncing')
    store.setError(null)

    const summary = await sync()

    // Update last sync time
    const syncState = await db.syncState.get('global')
    if (syncState?.lastSyncAt) {
      store.setLastSyncAt(syncState.lastSyncAt)
    }

    // Refresh counts
    await store.refreshCounts()

    // Reset status to idle
    store.setStatus('idle')

    // Reset backoff on successful sync
    currentBackoffDelay = 1000

    logger.info('Sync completed:', summary)
  } catch (error) {
    logger.error('Sync failed:', error)
    store.setStatus('error')
    store.setError(error instanceof Error ? error.message : 'Unknown sync error')

    // Apply exponential backoff
    currentBackoffDelay = Math.min(currentBackoffDelay * 2, MAX_BACKOFF_DELAY)
  }
}

/**
 * Trigger a manual sync operation
 *
 * Debounced to prevent rapid repeated syncs. Will wait for backoff delay
 * if previous sync failed.
 */
export async function triggerSync(): Promise<void> {
  // If there's an active backoff (after error), wait before syncing
  if (currentBackoffDelay > 1000) {
    logger.info(`Sync delayed by backoff: ${currentBackoffDelay}ms`)
    await new Promise((resolve) => setTimeout(resolve, currentBackoffDelay))
  }

  await executeSyncWithStateUpdates()
}

/**
 * Handle online event - trigger sync when connection is restored
 */
function handleOnline() {
  const store = useSyncStore.getState()
  logger.info('Network connection restored')
  store.setStatus('idle')
  currentSseReconnectDelay = SSE_INITIAL_RECONNECT_DELAY
  startSyncEventStream()

  // Trigger sync after a short delay to allow connection to stabilize
  setTimeout(() => {
    triggerSync().catch((error) => {
      logger.error('Auto-sync on reconnect failed:', error)
    })
  }, 1000)
}

/**
 * Handle offline event - update status
 */
function handleOffline() {
  const store = useSyncStore.getState()
  logger.info('Network connection lost')
  store.setStatus('offline')
  store.setError('Network connection unavailable')
  closeSyncEventSource()
  clearSyncEventReconnectTimeout()
  clearSyncEventDebounceTimeout()
}

/**
 * Start the sync scheduler
 *
 * - Registers online/offline event listeners
 * - Starts periodic background sync
 * - Sets initial online/offline status
 */
export function startSyncScheduler(intervalMs: number = DEFAULT_SYNC_INTERVAL): void {
  // Prevent double-start
  if (syncInterval !== null) {
    logger.warn('Sync scheduler already started')
    return
  }

  logger.info(`Starting sync scheduler with interval: ${intervalMs}ms`)

  // Set initial online/offline status
  const store = useSyncStore.getState()
  if (!navigator.onLine) {
    store.setStatus('offline')
  }
  void store.refreshCounts()

  // Register online/offline listeners
  if (!isOnlineListenerAttached) {
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    isOnlineListenerAttached = true
  }

  // Start periodic sync
  syncInterval = setInterval(() => {
    // Only sync if online
    if (navigator.onLine) {
      executeSyncWithStateUpdates().catch((error) => {
        logger.error('Periodic sync failed:', error)
      })
    }
  }, intervalMs)

  if (navigator.onLine) {
    startSyncEventStream()
  }

  // Trigger initial sync if online
  if (navigator.onLine) {
    clearInitialSyncTimeout()
    initialSyncTimeout = setTimeout(() => {
      initialSyncTimeout = null
      triggerSync().catch((error) => {
        logger.error('Initial sync failed:', error)
      })
    }, 1000)
  }
}

/**
 * Stop the sync scheduler
 *
 * - Clears the periodic sync interval
 * - Removes online/offline event listeners
 */
export function stopSyncScheduler(): void {
  logger.info('Stopping sync scheduler')

  // Clear interval
  if (syncInterval !== null) {
    clearInterval(syncInterval)
    syncInterval = null
  }

  closeSyncEventSource()
  clearSyncEventReconnectTimeout()
  clearSyncEventDebounceTimeout()
  clearInitialSyncTimeout()

  // Remove event listeners
  if (isOnlineListenerAttached) {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    isOnlineListenerAttached = false
  }

  // Reset backoff
  currentBackoffDelay = 1000
  currentSseReconnectDelay = SSE_INITIAL_RECONNECT_DELAY
}

/**
 * Check if the sync scheduler is currently running
 */
export function isSyncSchedulerRunning(): boolean {
  return syncInterval !== null
}
