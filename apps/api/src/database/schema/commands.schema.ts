import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Processed commands table — records every command that has been executed.
 *
 * Each row represents a single command invocation, capturing who ran it,
 * what they ran, and whether it succeeded. This provides a full audit trail
 * of all mutations that flow through the command engine.
 */
export const processedCommands = sqliteTable('processed_commands', {
  id: text('id').primaryKey(),
  /** The command type discriminant (e.g. 'createEntry', 'updateEntry'). */
  commandType: text('commandType').notNull(),
  /** JSON-serialised command payload. */
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
  /** JSON-serialised actor info: { userId, source }. */
  actor: text('actor', { mode: 'json' }).$type<{ userId: string; source: string }>(),
  /** JSON-serialised result data (nullable for in-progress or void results). */
  result: text('result', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  /** Execution outcome: 'success', 'failed', or 'dry_run'. */
  status: text('status').notNull(),
  /** Optional tenant scope for tenant-scoped command execution. */
  tenantScope: text('tenantScope'),
  /** ISO 8601 timestamp of when the command was executed. */
  executedAt: text('executedAt').notNull(),
})

/**
 * Audit log table — granular record of entity-level changes.
 *
 * Each row describes a single change to a single entity (entry, relation, etc.)
 * made as part of a command execution. A single command can produce multiple
 * audit log entries (e.g. a bulk update touching 5 entries creates 5 rows).
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    /** References the command that caused this change. */
    commandId: text('commandId')
      .notNull()
      .references(() => processedCommands.id, { onDelete: 'cascade' }),
    /** The type of entity that was changed (e.g. 'entry', 'relation'). */
    entityType: text('entityType').notNull(),
    /** The ID of the entity that was changed. */
    entityId: text('entityId').notNull(),
    /** The action performed (e.g. 'create', 'update', 'delete', 'link', 'unlink', 'publish', 'unpublish'). */
    action: text('action').notNull(),
    /** JSON-serialised field-level changes (nullable). */
    changes: text('changes', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    /** ISO 8601 timestamp of when this change occurred. */
    timestamp: text('timestamp').notNull(),
  },
  (table) => [
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
    index('audit_log_commandId_idx').on(table.commandId),
  ]
)
