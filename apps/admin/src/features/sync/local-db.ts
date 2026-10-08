import Dexie, { type Table } from 'dexie'
import { logger } from '@/lib/logger'

/**
 * Field definition structure matching the API collections schema
 */
export interface FieldDefinition {
  name: string
  type: string
  required: boolean
  localizable: boolean
  options?: Record<string, unknown>
}

/**
 * Local collection structure mirroring the server schema
 */
export interface LocalCollection {
  id: string
  name: string
  slug: string
  singleton: boolean
  fields: FieldDefinition[]
  defaultLocale: string
  supportedLocales: string[]
  createdAt: string
  updatedAt: string
}

/**
 * Local entry structure mirroring the server schema
 */
export interface LocalEntry {
  id: string
  collectionId: string
  slug: string
  status: string
  data: Record<string, unknown>
  version: number
  createdAt: string
  updatedAt: string
}

export interface LocalAsset {
  id: string
  filename: string
  mimeType: string
  size: number
  width?: number | null
  height?: number | null
  blurhash?: string | null
  createdAt: string
  updatedAt: string
}

export interface LocalSchemaSnapshot {
  id: string
  tenantId: string
  schemaVersion: number
  payload: Record<string, unknown>
  createdAt: string
}

/**
 * Local relation structure mirroring the server schema
 */
export interface LocalRelation {
  id: string
  sourceEntryId: string
  targetEntryId: string
  sourceCollectionId: string
  targetCollectionId: string
  relationType: string
  fieldName: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * Command queue item for offline command storage and sync
 */
export interface CommandQueueItem {
  id?: number // Auto-incremented by Dexie
  envelope: Record<string, unknown> // Command envelope
  tenantSlug?: string | null
  status: 'pending' | 'syncing' | 'synced' | 'conflicted'
  createdAt: string
  syncedAt?: string
  error?: string
  serverState?: Record<string, unknown> // For conflict resolution
}

/**
 * Sync state tracking for collections and global sync cursor
 */
export interface SyncState {
  id: string // 'global' or collection-specific key
  cursor: number
  lastSyncAt: string
  status: 'idle' | 'syncing' | 'error'
  errorMessage?: string
}

export interface MediaQueueItem {
  id?: number
  type: 'upload' | 'move' | 'delete'
  payload: Record<string, unknown>
  status: 'pending' | 'syncing' | 'synced' | 'failed'
  createdAt: string
  syncedAt?: string
  error?: string
}

/**
 * EdgeCMS IndexedDB database for offline-first data storage
 *
 * Stores collections, entries, relations, command queue, and sync state.
 * Enables offline editing with eventual consistency sync.
 */
class EdgeCMSDatabase extends Dexie {
  collections!: Table<LocalCollection, string>
  entries!: Table<LocalEntry, string>
  assets!: Table<LocalAsset, string>
  schemaSnapshots!: Table<LocalSchemaSnapshot, string>
  relations!: Table<LocalRelation, string>
  commandQueue!: Table<CommandQueueItem, number>
  syncState!: Table<SyncState, string>
  mediaQueue!: Table<MediaQueueItem, number>

  constructor() {
    super('edgecms')

    // Version 1 schema with indexes for efficient querying
    this.version(1).stores({
      collections: 'id, slug',
      entries: 'id, collectionId, slug, status, [collectionId+status]',
      relations: 'id, sourceEntryId, targetEntryId, [sourceEntryId+fieldName]',
      commandQueue: '++id, status, createdAt',
      syncState: 'id',
    })

    this.version(2).stores({
      collections: 'id, slug',
      entries: 'id, collectionId, slug, status, [collectionId+status]',
      relations: 'id, sourceEntryId, targetEntryId, [sourceEntryId+fieldName]',
      commandQueue: '++id, status, createdAt',
      syncState: 'id',
      mediaQueue: '++id, status, createdAt, type',
    })

    this.version(3).stores({
      collections: 'id, slug',
      entries: 'id, collectionId, slug, status, [collectionId+status]',
      relations: 'id, sourceEntryId, targetEntryId, [sourceEntryId+fieldName]',
      commandQueue: '++id, status, createdAt',
      syncState: 'id',
      mediaQueue: '++id, status, createdAt, type',
      httpMutationQueue: '++id, status, createdAt, method',
    })

    this.version(4)
      .stores({
        httpMutationQueue: null, // Remove deprecated table
      })
      .upgrade(async (trans) => {
        const oldQueue = trans.table('httpMutationQueue')
        const pendingItems = await oldQueue.where('status').equals('pending').toArray()

        const commandQueue = trans.table('commandQueue')
        for (const item of pendingItems) {
          await commandQueue.add({
            envelope: {
              type: 'httpMutation',
              payload: {
                method: item.method,
                path: item.path,
                body: item.body,
              },
              actor: { userId: 'local', source: 'admin' },
              timestamp: item.createdAt,
            },
            status: 'pending',
            createdAt: item.createdAt,
          })
        }
      })

    this.version(5).stores({
      collections: 'id, slug',
      entries: 'id, collectionId, slug, status, [collectionId+status]',
      assets: 'id, filename, mimeType, createdAt',
      schemaSnapshots: 'id, tenantId, schemaVersion, createdAt',
      relations: 'id, sourceEntryId, targetEntryId, [sourceEntryId+fieldName]',
      commandQueue: '++id, status, createdAt',
      syncState: 'id',
      mediaQueue: '++id, status, createdAt, type',
    })
  }
}

// Singleton database instance
const db = new EdgeCMSDatabase()

/**
 * Initialize the database with default sync state if needed
 */
async function initializeDatabase(): Promise<void> {
  // Check if global sync state exists
  const globalState = await db.syncState.get('global')

  if (!globalState) {
    // Create initial sync state
    await db.syncState.put({
      id: 'global',
      cursor: 0,
      lastSyncAt: '',
      status: 'idle',
    })
  }
}

// Initialize database on module load
initializeDatabase().catch((err) => {
  logger.error('Failed to initialize EdgeCMS database:', err)
})

// Export the singleton instance and types
export { db }
export type { EdgeCMSDatabase }
export default db
