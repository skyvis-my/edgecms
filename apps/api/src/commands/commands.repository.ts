import { eq } from 'drizzle-orm'
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

  async insertProcessedCommand(params: {
    db: Database
    commandId: string
    envelope: CommandEnvelope
    status: 'success' | 'failed' | 'dry_run'
    tenantScope: string | null
    result?: Record<string, unknown> | null
    executedAt: string
  }) {
    const { db, commandId, envelope, status, tenantScope, result, executedAt } = params

    await db.insert(processedCommands).values({
      id: commandId,
      commandType: envelope.type,
      payload: envelope.payload,
      actor: envelope.actor,
      result: result ?? null,
      status,
      tenantScope,
      executedAt,
    })
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
