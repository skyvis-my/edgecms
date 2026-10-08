import { schemaSnapshotsRepository } from '@/collections/schema-snapshots.repository'
import type { CommandContext } from '@/commands/engine'
import type { Database } from '@/database/db'
import { entriesRepository } from '@/entries/entries.repository'
import type { CommandEnvelope, CommandResult } from '@edgecms/schemas/commands'
import { syncRepository } from './sync.repository'

export const MAX_SYNC_PULL_LIMIT = 500

export type SyncPullChange = {
  sequence: number
  id: string
  entityType: string
  entityId: string
  commandId: string | null
  changeType: string
  payload: Record<string, unknown> | null
  timestamp: string
}

export type SyncPushInputCommand = {
  type: string
  payload: Record<string, unknown>
  timestamp?: string
  optimisticVersion?: number
  dryRun?: boolean
  transactionId?: string
}

export type SyncPushResult = {
  index: number
  status: 'success' | 'conflict' | 'failed'
  data?: Record<string, unknown>
  serverState?: Record<string, unknown>
  error?: { code?: string; message?: string }
}

type ExecuteCommandFn = (ctx: CommandContext, envelope: CommandEnvelope) => Promise<CommandResult>

type FindEntryByIdFn = (
  db: Database,
  id: string
) => Promise<
  | {
      version: number
      [key: string]: unknown
    }
  | undefined
>

export function normalizeSyncPullLimit(limit: number | undefined): number {
  return Math.min(limit ?? 100, MAX_SYNC_PULL_LIMIT)
}

export function buildSyncPullPayload(changes: SyncPullChange[], cursor: number, limit: number) {
  const hasMore = changes.length > limit
  const returnedChanges = hasMore ? changes.slice(0, limit) : changes
  const lastChange = returnedChanges[returnedChanges.length - 1]
  const newCursor = lastChange?.sequence ?? cursor

  return {
    changes: returnedChanges,
    cursor: newCursor,
    hasMore,
  }
}

export async function pullSyncChanges(params: {
  db: Database
  cursor: number
  limit: number
  tenantScope?: string
  includeAllTenants?: boolean
}) {
  const { db, cursor, limit, tenantScope, includeAllTenants = false } = params
  if (!includeAllTenants) {
    await ensureSchemaSnapshotChange(db, tenantScope)
  }
  const changes = await syncRepository.findChangesAfterCursor(db, {
    cursor,
    limit,
    tenantScope,
    includeAllTenants,
  })

  return buildSyncPullPayload(
    changes.map((c) => ({
      sequence: c.sequence,
      id: c.id,
      entityType: c.entityType,
      entityId: c.entityId,
      commandId: c.commandId,
      changeType: c.changeType,
      payload: c.payload,
      timestamp: c.timestamp,
    })),
    cursor,
    limit
  )
}

async function ensureSchemaSnapshotChange(db: Database, tenantScope?: string): Promise<void> {
  const snapshotTenant = tenantScope ?? 'global'
  const snapshot = await schemaSnapshotsRepository.findLatestSnapshot(db, snapshotTenant)
  if (!snapshot) return

  const existing = await syncRepository.findExistingChangeLogEntry(db, {
    entityType: 'schema_snapshot',
    entityId: snapshot.id,
    tenantScope,
  })
  if (existing) return

  await syncRepository.insertChangeLogEntry(db, {
    id: crypto.randomUUID(),
    entityType: 'schema_snapshot',
    entityId: snapshot.id,
    commandId: null,
    changeType: 'upsert',
    tenantScope: tenantScope ?? null,
    payload: {
      id: snapshot.id,
      tenantId: snapshot.tenantId,
      schemaVersion: snapshot.schemaVersion,
      payload: snapshot.payload,
      createdAt: snapshot.createdAt,
    },
    timestamp: new Date().toISOString(),
  })
}

export async function executeSyncPushCommands(params: {
  commands: SyncPushInputCommand[]
  userId: string
  db: Database
  kv: KVNamespace
  syncChannel: string
  executeCommandFn: ExecuteCommandFn
  findEntryByIdFn?: FindEntryByIdFn
}): Promise<SyncPushResult[]> {
  const { commands, userId, db, kv, syncChannel, executeCommandFn } = params
  const findEntryByIdFn = params.findEntryByIdFn ?? entriesRepository.findById

  const results: SyncPushResult[] = []

  for (const [index, command] of commands.entries()) {
    try {
      const enrichedCommand: CommandEnvelope = {
        type: command.type as CommandEnvelope['type'],
        payload: command.payload,
        actor: { userId, source: 'sync' },
        timestamp: command.timestamp ?? new Date().toISOString(),
        optimisticVersion: command.optimisticVersion,
        dryRun: command.dryRun,
        transactionId: command.transactionId,
      }

      const result = await executeCommandFn(
        {
          db,
          actor: enrichedCommand.actor,
          kv,
          syncChannel,
        },
        enrichedCommand
      )

      if (result.status === 'failed' && result.error?.code === 'VERSION_CONFLICT') {
        const entryId =
          typeof enrichedCommand.payload.entryId === 'string'
            ? enrichedCommand.payload.entryId
            : undefined

        const latestEntry = entryId ? await findEntryByIdFn(db, entryId) : undefined
        const conflictingFields = getConflictingFields(enrichedCommand.payload.data)

        results.push({
          index,
          status: 'conflict',
          error: result.error,
          serverState: latestEntry
            ? {
                entry: latestEntry,
                version: latestEntry.version,
                conflictingFields,
              }
            : undefined,
        })
        continue
      }

      if (result.status === 'success') {
        results.push({
          index,
          status: 'success',
          data: result.data,
        })
        continue
      }

      results.push({
        index,
        status: 'failed',
        error: result.error,
      })
    } catch (error) {
      results.push({
        index,
        status: 'failed',
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      })
    }
  }

  return results
}

function getConflictingFields(payloadData: unknown): string[] {
  if (!payloadData || typeof payloadData !== 'object' || Array.isArray(payloadData)) {
    return []
  }
  return Object.keys(payloadData as Record<string, unknown>)
}
