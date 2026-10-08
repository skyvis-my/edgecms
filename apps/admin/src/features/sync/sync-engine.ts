import type { CommandEnvelope } from '@/features/commands/command-builder'
import { edenDelete, edenGet, edenPost, edenPostForTenant, edenPut } from '@/lib/eden-client'
import { db } from './local-db'

/**
 * Server response types matching the sync backend API
 */
interface ChangeLogEntry {
  sequence: number
  id: string
  entityType: 'entry' | 'collection' | 'relation' | 'schema_snapshot'
  entityId: string
  commandId: string
  changeType: 'create' | 'update' | 'delete'
  payload: Record<string, unknown>
  timestamp: string
}

interface PullResponse {
  changes: ChangeLogEntry[]
  cursor: number
  hasMore: boolean
}

interface PushResult {
  index: number
  status: 'success' | 'conflict' | 'failed'
  data?: Record<string, unknown>
  serverState?: {
    entry: Record<string, unknown>
    version: number
    conflictingFields: string[]
  }
  error?: { code: string; message: string } | string
}

interface PushResponse {
  results: PushResult[]
}

type CompactQueueCommand = {
  command: CommandEnvelope
  queueItemIds: number[]
}

type QueueBatch = {
  tenantSlug: string | null
  commands: CompactQueueCommand[]
}

const PUSH_BATCH_SIZE = 100

/**
 * Summary returned after push operation
 */
export interface PushSummary {
  synced: number
  conflicted: number
  failed: number
}

/**
 * Summary returned after pull operation
 */
export interface PullSummary {
  changesApplied: number
  newCursor: number
}

/**
 * Combined summary from full sync
 */
export interface SyncSummary {
  push: PushSummary
  pull: PullSummary
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePushError(error: unknown): string | undefined {
  if (typeof error === 'string') {
    return error
  }
  if (isRecord(error)) {
    const message = typeof error.message === 'string' ? error.message : undefined
    return message
  }
  return undefined
}

function canMergeUpdateCommands(previous: CommandEnvelope, next: CommandEnvelope): boolean {
  if (previous.type !== 'updateEntry' || next.type !== 'updateEntry') return false
  if (previous.optimisticVersion !== undefined || next.optimisticVersion !== undefined) return false
  if (previous.dryRun || next.dryRun) return false
  if (previous.transactionId || next.transactionId) return false
  if (!isRecord(previous.payload) || !isRecord(next.payload)) return false
  return (
    typeof previous.payload.entryId === 'string' &&
    typeof next.payload.entryId === 'string' &&
    previous.payload.entryId === next.payload.entryId
  )
}

function mergeUpdateCommands(previous: CommandEnvelope, next: CommandEnvelope): CommandEnvelope {
  const mergedPayload: Record<string, unknown> = {
    ...(previous.payload as Record<string, unknown>),
  }
  const nextPayload = next.payload as Record<string, unknown>

  for (const [key, value] of Object.entries(nextPayload)) {
    if (key === 'data') {
      if (isRecord(value)) {
        const current = isRecord(mergedPayload.data) ? mergedPayload.data : {}
        mergedPayload.data = { ...current, ...value }
      }
      continue
    }

    if (value !== undefined) {
      mergedPayload[key] = value
    }
  }

  return {
    ...previous,
    payload: mergedPayload,
    timestamp: next.timestamp,
  }
}

function compactQueuedCommands(
  pendingItems: Array<{ id?: number; envelope: Record<string, unknown> }>
): CompactQueueCommand[] {
  const compacted: CompactQueueCommand[] = []

  for (const item of pendingItems) {
    if (item.id === undefined) continue
    const command = item.envelope as CommandEnvelope
    const last = compacted[compacted.length - 1]

    if (last && canMergeUpdateCommands(last.command, command)) {
      last.command = mergeUpdateCommands(last.command, command)
      last.queueItemIds.push(item.id)
      continue
    }

    compacted.push({
      command,
      queueItemIds: [item.id],
    })
  }

  return compacted
}

function buildQueueBatches(
  pendingItems: Array<{
    id?: number
    envelope: Record<string, unknown>
    tenantSlug?: string | null
  }>
): QueueBatch[] {
  const byTenant = new Map<string, Array<{ id?: number; envelope: Record<string, unknown> }>>()

  for (const item of pendingItems) {
    const tenantSlug = item.tenantSlug ?? null
    const tenantKey = tenantSlug ?? '__global__'
    const tenantItems = byTenant.get(tenantKey)
    if (tenantItems) {
      tenantItems.push(item)
      continue
    }
    byTenant.set(tenantKey, [item])
  }

  const batches: QueueBatch[] = []
  for (const [tenantKey, tenantItems] of byTenant.entries()) {
    batches.push({
      tenantSlug: tenantKey === '__global__' ? null : tenantKey,
      commands: compactQueuedCommands(tenantItems),
    })
  }

  return batches
}

async function markQueueItems(
  queueItemIds: number[],
  updates: {
    status: 'synced' | 'conflicted'
    syncedAt?: string
    error?: string
    serverState?: Record<string, unknown>
  }
): Promise<void> {
  for (const queueItemId of queueItemIds) {
    await db.commandQueue.update(queueItemId, updates)
  }
}

type DexiePutTable = {
  bulkPut?: (items: Record<string, unknown>[]) => Promise<unknown>
  put: (item: Record<string, unknown>) => Promise<unknown>
}

type DexieDeleteTable = {
  bulkDelete?: (keys: string[]) => Promise<unknown>
  delete: (key: string) => Promise<unknown>
}

async function bulkPutOrFallback(
  table: DexiePutTable,
  records: Record<string, unknown>[]
): Promise<void> {
  if (records.length === 0) return
  if (typeof table.bulkPut === 'function') {
    await table.bulkPut(records)
    return
  }
  for (const record of records) {
    await table.put(record)
  }
}

async function bulkDeleteOrFallback(table: DexieDeleteTable, keys: string[]): Promise<void> {
  if (keys.length === 0) return
  if (typeof table.bulkDelete === 'function') {
    await table.bulkDelete(keys)
    return
  }
  for (const key of keys) {
    await table.delete(key)
  }
}

/**
 * Push pending commands from the local queue to the server.
 *
 * Process:
 * 1. Query pending commands from commandQueue
 * 2. Separate httpMutation commands from regular commands
 * 3. Replay httpMutation commands as direct HTTP calls
 * 4. Push regular commands via /admin/sync/push
 * 5. Handle results
 */
export async function pushPendingCommands(): Promise<PushSummary> {
  const summary: PushSummary = { synced: 0, conflicted: 0, failed: 0 }

  // Get all pending commands
  const pendingItems = await db.commandQueue.where('status').equals('pending').toArray()
  const orderedPendingItems = [...pendingItems].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))

  if (orderedPendingItems.length === 0) {
    return summary
  }

  // Partition into httpMutation commands and regular commands
  const httpMutationItems = orderedPendingItems.filter(
    (item) => (item.envelope as Record<string, unknown>).type === 'httpMutation'
  )
  const regularItems = orderedPendingItems.filter(
    (item) => (item.envelope as Record<string, unknown>).type !== 'httpMutation'
  )

  // Process HTTP mutation commands first (replay as direct HTTP calls)
  for (const item of httpMutationItems) {
    if (item.id === undefined) continue

    // Validate payload structure before using it
    const envelope = item.envelope as Record<string, unknown>
    const rawPayload = envelope.payload
    if (
      !isRecord(rawPayload) ||
      typeof rawPayload.method !== 'string' ||
      typeof rawPayload.path !== 'string'
    ) {
      await db.commandQueue.update(item.id, {
        status: 'conflicted',
        error: 'Malformed httpMutation payload: missing or invalid method/path',
      })
      summary.conflicted += 1
      continue
    }
    const payload = rawPayload as { method: string; path: string; body?: unknown }

    try {
      await db.commandQueue.update(item.id, { status: 'syncing' })

      if (payload.method === 'POST') {
        await edenPost(payload.path, payload.body)
      } else if (payload.method === 'PUT') {
        await edenPut(payload.path, payload.body)
      } else if (payload.method === 'DELETE') {
        await edenDelete(payload.path)
      } else {
        // Unsupported HTTP method — mark as conflicted
        await db.commandQueue.update(item.id, {
          status: 'conflicted',
          error: `Unsupported HTTP method: ${payload.method}`,
        })
        summary.conflicted += 1
        continue
      }

      await db.commandQueue.update(item.id, {
        status: 'synced',
        syncedAt: new Date().toISOString(),
      })
      summary.synced += 1
    } catch (error) {
      // On retryable error (5xx/network), revert to pending
      if (
        error instanceof TypeError ||
        (error &&
          typeof error === 'object' &&
          'status' in error &&
          (error as { status: number }).status >= 500)
      ) {
        await db.commandQueue.update(item.id, { status: 'pending' })
        throw error // Stop processing, retry next sync cycle
      }
      // Non-retryable error (4xx): mark as conflicted
      await db.commandQueue.update(item.id, {
        status: 'conflicted',
        error: error instanceof Error ? error.message : 'HTTP mutation replay failed',
      })
      summary.failed += 1
    }
  }

  // Process regular commands using existing batch/compaction/push logic
  if (regularItems.length === 0) {
    return summary
  }

  // Mark regular items as syncing
  await db.transaction('rw', db.commandQueue, async () => {
    for (const item of regularItems) {
      if (item.id !== undefined) {
        await db.commandQueue.update(item.id, { status: 'syncing' })
      }
    }
  })

  // Compact consecutive updateEntry commands for the same entry into a single payload.
  // Compaction is tenant-scoped to avoid cross-tenant replay on the wrong endpoint.
  const queueBatches = buildQueueBatches(regularItems)
  const processedItemIds = new Set<number>()

  try {
    for (const queueBatch of queueBatches) {
      const compactCommands = queueBatch.commands
      for (let offset = 0; offset < compactCommands.length; offset += PUSH_BATCH_SIZE) {
        const batch = compactCommands.slice(offset, offset + PUSH_BATCH_SIZE)
        const response = await edenPostForTenant<PushResponse>(
          '/admin/sync/push',
          {
            commands: batch.map((item) => item.command),
          },
          queueBatch.tenantSlug
        )

        // Process each batch result
        await db.transaction('rw', db.commandQueue, async () => {
          for (let i = 0; i < batch.length; i++) {
            const compactItem = batch[i]
            const result = response.results[i]
            if (!compactItem) continue

            for (const queueItemId of compactItem.queueItemIds) {
              processedItemIds.add(queueItemId)
            }

            if (!result) {
              await markQueueItems(compactItem.queueItemIds, {
                status: 'conflicted',
                error: 'Missing sync result from server',
              })
              summary.failed += compactItem.queueItemIds.length
              continue
            }

            if (result.status === 'success') {
              await markQueueItems(compactItem.queueItemIds, {
                status: 'synced',
                syncedAt: new Date().toISOString(),
                error: undefined,
                serverState: undefined,
              })
              summary.synced += compactItem.queueItemIds.length
              continue
            }

            if (result.status === 'conflict') {
              await markQueueItems(compactItem.queueItemIds, {
                status: 'conflicted',
                serverState: result.serverState,
                error: normalizePushError(result.error),
              })
              summary.conflicted += compactItem.queueItemIds.length
              continue
            }

            await markQueueItems(compactItem.queueItemIds, {
              status: 'conflicted',
              error: normalizePushError(result.error) ?? 'Command execution failed',
            })
            summary.failed += compactItem.queueItemIds.length
          }
        })
      }
    }
  } catch (error) {
    // Network/server failure: only revert commands that were not processed yet.
    await db.transaction('rw', db.commandQueue, async () => {
      for (const item of regularItems) {
        if (item.id !== undefined && !processedItemIds.has(item.id)) {
          await db.commandQueue.update(item.id, { status: 'pending' })
        }
      }
    })
    throw error
  }

  return summary
}

/**
 * Pull changes from the server and apply them to local Dexie tables.
 *
 * Process:
 * 1. Get current cursor from syncState
 * 2. GET /admin/sync/pull?cursor=X&limit=100
 * 3. Apply each change to appropriate table
 * 4. Update syncState with new cursor
 * 5. If hasMore, recursively pull again
 */
export async function pullChanges(): Promise<PullSummary> {
  let totalChanges = 0
  let currentCursor = 0

  // Get current sync state
  const syncState = await db.syncState.get('global')
  currentCursor = syncState?.cursor || 0

  let hasMore = true

  while (hasMore) {
    // Pull changes from server
    const response = await edenGet<PullResponse>(
      `/admin/sync/pull?cursor=${currentCursor}&limit=100`
    )

    const { changes, cursor: newCursor, hasMore: serverHasMore } = response

    // Apply changes to local database
    await db.transaction(
      'rw',
      [db.collections, db.entries, db.relations, db.schemaSnapshots, db.syncState],
      async () => {
        const entriesToPut: Record<string, unknown>[] = []
        const collectionsToPut: Record<string, unknown>[] = []
        const relationsToPut: Record<string, unknown>[] = []
        const schemaSnapshotsToPut: Record<string, unknown>[] = []
        const entryIdsToDelete: string[] = []
        const collectionIdsToDelete: string[] = []
        const relationIdsToDelete: string[] = []

        for (const change of changes) {
          if (change.entityType === 'entry') {
            if (change.changeType === 'create' || change.changeType === 'update') {
              if (isRecord(change.payload)) {
                entriesToPut.push(change.payload)
              }
            } else if (change.changeType === 'delete') {
              entryIdsToDelete.push(change.entityId)
            }
          } else if (change.entityType === 'collection') {
            if (change.changeType === 'create' || change.changeType === 'update') {
              if (isRecord(change.payload)) {
                collectionsToPut.push(change.payload)
              }
            } else if (change.changeType === 'delete') {
              collectionIdsToDelete.push(change.entityId)
            }
          } else if (change.entityType === 'relation') {
            if (change.changeType === 'create' || change.changeType === 'update') {
              if (isRecord(change.payload)) {
                relationsToPut.push(change.payload)
              }
            } else if (change.changeType === 'delete') {
              relationIdsToDelete.push(change.entityId)
            }
          } else if (change.entityType === 'schema_snapshot') {
            if (isRecord(change.payload)) {
              schemaSnapshotsToPut.push(change.payload)
            }
          }
        }

        await bulkPutOrFallback(db.collections as unknown as DexiePutTable, collectionsToPut)
        await bulkPutOrFallback(db.entries as unknown as DexiePutTable, entriesToPut)
        await bulkPutOrFallback(db.relations as unknown as DexiePutTable, relationsToPut)
        await bulkPutOrFallback(
          db.schemaSnapshots as unknown as DexiePutTable,
          schemaSnapshotsToPut
        )
        await bulkDeleteOrFallback(
          db.collections as unknown as DexieDeleteTable,
          Array.from(new Set(collectionIdsToDelete))
        )
        await bulkDeleteOrFallback(
          db.entries as unknown as DexieDeleteTable,
          Array.from(new Set(entryIdsToDelete))
        )
        await bulkDeleteOrFallback(
          db.relations as unknown as DexieDeleteTable,
          Array.from(new Set(relationIdsToDelete))
        )

        // Update sync state
        await db.syncState.put({
          id: 'global',
          cursor: newCursor,
          lastSyncAt: new Date().toISOString(),
          status: 'idle',
        })
      }
    )

    totalChanges += changes.length
    currentCursor = newCursor
    hasMore = serverHasMore
  }

  return {
    changesApplied: totalChanges,
    newCursor: currentCursor,
  }
}

/**
 * Perform a full bidirectional sync: push then pull.
 *
 * This is the main entry point for sync operations.
 */
export async function sync(): Promise<SyncSummary> {
  // Push-before-pull strategy
  const pushSummary = await pushPendingCommands()
  const pullSummary = await pullChanges()

  return {
    push: pushSummary,
    pull: pullSummary,
  }
}
