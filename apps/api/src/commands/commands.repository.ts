import { and, eq, lt, or } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { auditLog, changeLog, processedCommands } from '@/database/schema'
import type { CommandEnvelope } from '@edgecms/schemas/commands'

type AuditEntry = {
  entityType: string
  entityId: string
  action: string
  changes?: Record<string, unknown>
}

export const commandsRepository = {
  async findById(db: Database, commandId: string) {
    const rows = await db
      .select()
      .from(processedCommands)
      .where(eq(processedCommands.id, commandId))
      .limit(1)
    return rows[0] ?? null
  },

  /**
   * CMD-04: atomically reserve an idempotency key as `pending`.
   *
   * Returns true only for the one caller that now owns the key. The insert
   * uses ON CONFLICT DO NOTHING + RETURNING, so of several simultaneous
   * first requests exactly one gets a row back (D1, SQLite and Postgres).
   * When the key exists, a single conditional UPDATE (compare-and-set on the
   * row's state) lets one caller claim it if it is a legacy `dry_run`
   * preview (CMD-03) or a `pending` reservation of the same command type
   * whose lease expired (`executedAt` older than `staleBefore`), which a
   * crashed request leaves behind. Every other caller gets false and must
   * re-read the row.
   */
  async reservePending(params: {
    db: Database
    commandId: string
    envelope: CommandEnvelope
    tenantScope: string | null
    now: string
    staleBefore: string
  }): Promise<boolean> {
    const { db, commandId, envelope, tenantScope, now, staleBefore } = params
    const fields = {
      commandType: envelope.type,
      payload: envelope.payload,
      actor: envelope.actor,
      result: null,
      status: 'pending',
      tenantScope,
      executedAt: now,
    }

    const inserted = await db
      .insert(processedCommands)
      .values({ id: commandId, ...fields })
      // No conflict target: Drizzle would emit a table-qualified column,
      // which Postgres rejects. `id` is the table's only unique key.
      .onConflictDoNothing()
      .returning({ id: processedCommands.id })
    if (inserted.length > 0) return true

    const claimed = await db
      .update(processedCommands)
      .set(fields)
      .where(
        and(
          eq(processedCommands.id, commandId),
          or(
            eq(processedCommands.status, 'dry_run'),
            and(
              eq(processedCommands.status, 'pending'),
              eq(processedCommands.commandType, envelope.type),
              lt(processedCommands.executedAt, staleBefore)
            )
          )
        )
      )
      .returning({ id: processedCommands.id })
    return claimed.length > 0
  },

  async insertProcessedCommand(params: {
    db: Database
    commandId: string
    envelope: CommandEnvelope
    status: 'success' | 'failed' | 'dry_run' | 'pending'
    tenantScope: string | null
    result?: Record<string, unknown> | null
    executedAt: string
  }) {
    const { db, commandId, envelope, status, tenantScope, result, executedAt } = params

    const insertBuilder = db.insert(processedCommands).values({
      id: commandId,
      commandType: envelope.type,
      payload: envelope.payload,
      actor: envelope.actor,
      result: result ?? null,
      status,
      tenantScope,
      executedAt,
    })

    if (typeof (insertBuilder as unknown as { onConflictDoUpdate?: unknown }).onConflictDoUpdate === 'function') {
      // Pending->terminal guard: only allow overwriting a 'pending' reservation.
      // Drizzle sqlite onConflictDoUpdate has no WHERE support, so enforce in code:
      // never overwrite a terminal (success/failed) outcome with another state.
      // A legacy 'dry_run' row is a preview, not an outcome, so a real
      // execution may claim its key (CMD-03).
      const existing = await this.findById(db, commandId).catch(() => null)
      const claimable = existing?.status === 'pending' || existing?.status === 'dry_run'
      if (existing && !claimable && status !== existing.status) {
        // Keep the first terminal outcome (idempotent replay returns it via checkIdempotency).
        return
      }
      await (insertBuilder as unknown as { onConflictDoUpdate: (args: unknown) => Promise<unknown> }).onConflictDoUpdate({
        target: processedCommands.id,
        set: {
          status,
          result: result ?? null,
          executedAt,
          // Claiming a legacy preview row takes over its identity so later
          // replays compare against the executed envelope.
          ...(existing?.status === 'dry_run'
            ? { commandType: envelope.type, payload: envelope.payload, actor: envelope.actor, tenantScope }
            : {}),
        },
      })
    } else {
      await insertBuilder
    }
  },

  async insertAuditEntries(params: {
    db: Database
    commandId: string
    entries: AuditEntry[]
    timestamp: string
  }) {
    const { db, commandId, entries, timestamp } = params
    if (entries.length === 0) return

    await db.insert(auditLog).values(
      entries.map((entry) => ({
        id: crypto.randomUUID(),
        commandId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        changes: entry.changes ?? null,
        timestamp,
      }))
    )
  },

  async insertChangeLogEntries(params: {
    db: Database
    commandId: string | null
    entries: AuditEntry[]
    tenantScope: string | null
    timestamp: string
  }) {
    const { db, commandId, entries, tenantScope, timestamp } = params
    if (entries.length === 0) return

    await db.insert(changeLog).values(
      entries.map((entry) => ({
        id: crypto.randomUUID(),
        entityType: entry.entityType,
        entityId: entry.entityId,
        commandId,
        changeType: entry.action,
        tenantScope,
        payload: entry.changes ?? null,
        timestamp,
      }))
    )
  },
}
