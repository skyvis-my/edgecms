import { schemaSnapshotsRepository } from '@/collections/schema-snapshots.repository'
import type { CommandContext } from '@/commands/engine'
import type { ContentAccess } from '@/auth/content-access'
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

/** Entry data at an exact version (the entry_versions snapshot), or undefined if pruned. */
type FindVersionDataFn = (
  db: Database,
  entryId: string,
  version: number
) => Promise<Record<string, unknown> | undefined>

type FindEntryByIdFn = (
  db: Database,
  id: string,
  tenantId?: string
) => Promise<
  | {
      version: number
      [key: string]: unknown
    }
  | undefined
>

export function normalizeSyncPullLimit(limit: number | undefined): number {
  const raw = Number.isFinite(limit as number) ? Math.floor(limit as number) : 100
  return Math.min(Math.max(raw, 1), MAX_SYNC_PULL_LIMIT)
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
  findVersionDataFn?: FindVersionDataFn
  /** PL-03: the caller's per-collection content access, checked per command. */
  contentAccess?: ContentAccess
}): Promise<SyncPushResult[]> {
  const { commands, userId, db, kv, syncChannel, executeCommandFn } = params
  const findEntryByIdFn = params.findEntryByIdFn ?? entriesRepository.findById
  const findVersionDataFn = params.findVersionDataFn ?? findVersionData
  // OF-04: commands run in the tenant they were pushed to, like the commands route.
  const tenantScope = syncChannel && syncChannel !== 'global' ? syncChannel : undefined

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
          ...(tenantScope && { tenantScope }),
          ...(params.contentAccess && { contentAccess: params.contentAccess }),
        },
        enrichedCommand
      )

      if (result.status === 'failed' && result.error?.code === 'VERSION_CONFLICT') {
        const entryId =
          typeof enrichedCommand.payload.entryId === 'string'
            ? enrichedCommand.payload.entryId
            : undefined

        // OF-04/P2: read the newer server state from the same tenant the command ran in;
        // an unscoped lookup reads 'global' and returns nothing for tenant entries.
        const latestEntry = entryId ? await findEntryByIdFn(db, entryId, tenantScope) : undefined
        // The base is read only after the tenant-scoped lookup found the entry.
        const baseData =
          latestEntry && entryId && typeof enrichedCommand.optimisticVersion === 'number'
            ? await findVersionDataFn(db, entryId, enrichedCommand.optimisticVersion)
            : undefined
        const conflictingFields = getConflictingFields(
          enrichedCommand.payload.data,
          latestEntry?.data,
          baseData
        )

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

async function findVersionData(
  db: Database,
  entryId: string,
  version: number
): Promise<Record<string, unknown> | undefined> {
  // Best effort: without the snapshot the conflict falls back to a two-way field list.
  try {
    const row = await entriesRepository.findVersionByNumber(db, entryId, version)
    return asRecord(row?.data)
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Structural equality for JSON values; object key order is ignored. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(b)) {
    const ar = a as Record<string, unknown>
    const br = b as Record<string, unknown>
    const ak = Object.keys(ar).filter((k) => ar[k] !== undefined)
    const bk = Object.keys(br).filter((k) => br[k] !== undefined)
    return ak.length === bk.length && ak.every((k) => jsonEqual(ar[k], br[k]))
  }
  return false
}

/**
 * OF-04: the sent fields that truly conflict.
 * - With the base snapshot: fields changed on both sides (relative to the base) to different values.
 * - Without it: sent fields that differ from the server.
 * - Without server data: every sent field.
 */
export function getConflictingFields(
  payloadData: unknown,
  serverData?: unknown,
  baseData?: unknown
): string[] {
  const local = asRecord(payloadData)
  if (!local) return []
  const server = asRecord(serverData)
  if (!server) return Object.keys(local)
  const base = asRecord(baseData)
  return Object.keys(local).filter((field) => {
    if (jsonEqual(local[field], server[field])) return false
    if (!base) return true
    return !jsonEqual(local[field], base[field]) && !jsonEqual(server[field], base[field])
  })
}
