import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Tenant deletion jobs (HS-09). One row per offboarding request:
 * `requested` → `confirmed` (deleting, resumable) → `completed`, or
 * `cancelled` before confirmation.
 *
 * This is a control-plane record. It keeps the tenant snapshot, the per-table
 * deletion counts and the audit receipt id after the tenant itself is gone,
 * so it is never removed by tenant deletion.
 */
export const tenantDeletionJobs = sqliteTable(
  'tenant_deletion_jobs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    tenantSlug: text('tenant_slug').notNull(),
    tenantName: text('tenant_name').notNull(),
    /** Status before the request suspended the tenant; restored on cancel. */
    previousStatus: text('previous_status').notNull(),
    /** `requested` | `confirmed` | `completed` | `cancelled`. */
    status: text('status').notNull().default('requested'),
    requestedBy: text('requested_by').notNull(),
    requestedAt: text('requested_at').notNull(),
    /** Export receipt id the confirmation referenced. */
    exportId: text('export_id'),
    confirmedBy: text('confirmed_by'),
    confirmedAt: text('confirmed_at'),
    /** JSON object: rows deleted per table, accumulated chunk by chunk. */
    counts: text('counts', { mode: 'json' }).notNull().$type<Record<string, number>>(),
    r2ObjectsQueued: integer('r2_objects_queued').notNull().default(0),
    r2QueuedAt: text('r2_queued_at'),
    receiptAuditEventId: text('receipt_audit_event_id'),
    eventEmittedAt: text('event_emitted_at'),
    /** A run holds the job until this time so two runs never interleave. */
    leaseUntil: text('lease_until'),
    lastError: text('last_error'),
    completedAt: text('completed_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('tenant_deletion_jobs_tenant_idx').on(table.tenantId),
    uniqueIndex('tenant_deletion_jobs_open_unique')
      .on(table.tenantId)
      .where(sql`${table.status} IN ('requested', 'confirmed')`),
  ]
)

export type TenantDeletionJobRow = typeof tenantDeletionJobs.$inferSelect
