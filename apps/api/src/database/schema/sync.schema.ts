import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { processedCommands } from './commands.schema'

/**
 * Change log table — cursor-based sync feed for offline-first clients.
 *
 * This table provides a sequential, append-only log of all entity changes
 * in the CMS. Clients use it to pull incremental updates since their last sync,
 * implementing a simple cursor-based sync protocol.
 *
 * The `sequence` column is an auto-incrementing integer that serves as the sync cursor.
 * Clients track their last seen sequence number and pull changes > that value.
 *
 * Each row represents a single entity-level change (create, update, delete, publish, etc.)
 * and is created automatically by the command engine after successful command execution.
 */
export const changeLog = sqliteTable(
  'change_log',
  {
    /** Auto-incrementing sequence number (sync cursor). */
    sequence: integer('sequence', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    /** Unique UUID for this change log entry. */
    id: text('id').notNull().unique(),
    /** The type of entity that changed (e.g. 'entry', 'collection', 'relation'). */
    entityType: text('entityType').notNull(),
    /** The ID of the entity that changed. */
    entityId: text('entityId').notNull(),
    /** References the command that caused this change (nullable for system-initiated changes). */
    commandId: text('commandId').references(() => processedCommands.id, { onDelete: 'set null' }),
    /** The type of change (e.g. 'create', 'update', 'delete', 'publish', 'unpublish', 'link', 'unlink'). */
    changeType: text('changeType').notNull(),
    /** Optional tenant scope for tenant-scoped change streams. */
    tenantScope: text('tenantScope'),
    /** JSON-serialised change details/payload (nullable). */
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    /** ISO 8601 timestamp of when this change occurred. */
    timestamp: text('timestamp').notNull(),
  },
  (table) => [
    // Index for querying changes by entity
    index('change_log_entity_idx').on(table.entityType, table.entityId),
    index('change_log_tenant_scope_idx').on(table.tenantScope),
    index('change_log_tenant_scope_sequence_idx').on(table.tenantScope, table.sequence),
    // Index for efficient cursor-based sync queries (sequence is already indexed as PK)
  ]
)
