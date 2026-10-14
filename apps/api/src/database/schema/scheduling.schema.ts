import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Schedule intents table — durable intent log for publish/unpublish
 * scheduler (Durable Object) notifications.
 *
 * The schedule/cancel command handlers commit the entry update first, then
 * record an intent here and notify the DO. If the DO call is lost (crash,
 * timeout, deferred-work drop), the row stays open (pending/cancelled) and
 * the sweeper (see schedule-intents.repository sweepScheduleIntents,
 * triggered via POST /api/admin/system/sweep-schedules) reconciles the DO
 * queue against entry timestamps:
 * - pending: entry still carries the timestamp → re-notify the DO.
 * - cancelled: entry timestamps cleared → re-issue the DO cancel
 *   (prevents phantom publish after a lost cancel).
 * - done: reconciled, or stale (entry deleted/rescheduled elsewhere).
 *
 * One row per (entry, transition): a reschedule overwrites the previous
 * intent, so the sweeper never acts on superseded timestamps.
 */
export const scheduleIntents = sqliteTable(
  'schedule_intents',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id').notNull(),
    /** 'publish' or 'unpublish'. */
    transitionType: text('transition_type').notNull(),
    /** ISO 8601 timestamp the DO should fire at (null for cancel intents). */
    scheduledAt: text('scheduled_at'),
    tenantScope: text('tenant_scope').notNull().default('global'),
    /** 'pending' | 'cancelled' | 'done'. */
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('schedule_intents_entry_transition_unique').on(
      table.entryId,
      table.transitionType
    ),
    index('schedule_intents_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
  ]
)
