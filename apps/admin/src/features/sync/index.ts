/**
 * Sync feature exports
 *
 * Provides offline-first sync capabilities for EdgeCMS.
 */

// UI components
export { ConflictResolver } from './components/conflict-resolver'
export { SyncStatusIndicator } from './components/sync-status-indicator'
export type {
  CommandQueueItem,
  FieldDefinition,
  LocalCollection,
  LocalEntry,
  LocalRelation,
  SyncState,
} from './local-db'
// Local database
export { db } from './local-db'
// Pages
export { Conflicts } from './pages/conflicts'
// Command queue utilities
export { queueCommand } from './queue-command'
export type { PullSummary, PushSummary, SyncSummary } from './sync-engine'
// Core sync engine
export { pullChanges, pushPendingCommands, sync } from './sync-engine'
// React provider
export { SyncProvider } from './sync-provider'
// Sync scheduler
export {
  isSyncSchedulerRunning,
  startSyncScheduler,
  stopSyncScheduler,
  triggerSync,
} from './sync-scheduler'
export type { SyncStatus } from './sync-store'
// Sync state store
export { useSyncStore } from './sync-store'
