import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * CMD-06: durable post-commit side-effect intents.
 *
 * The command engine writes one row per side effect (KV snapshot
 * invalidation, CDN tag purge, frontend revalidation, RAG indexing, FTS sync)
 * in the same D1 batch as the processed command. The engine runs the intents
 * after the commit and marks them `done`; rows that stay `pending` (crash,
 * failed call) are retried by `relaySideEffectIntents`. After the last
 * attempt a row is `failed` and kept for inspection.
 */
export const sideEffectIntents = sqliteTable(
  'side_effect_intents',
  {
    id: text('id').primaryKey(),
    /** Command that produced the intent. */
    commandId: text('command_id'),
    /** Tenant scope: 'global' or tenant ID. */
    tenantScope: text('tenant_scope').notNull().default('global'),
    /** kv_invalidate | cdn_purge | frontend_revalidate | rag_index | fts_sync */
    kind: text('kind').notNull(),
    /** JSON input for the side effect (tags, paths, entry ID). Never secrets. */
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    /** pending | done | failed */
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** ISO 8601: earliest time the relay may try the row again. */
    nextAttemptAt: text('next_attempt_at'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('side_effect_intents_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
    index('side_effect_intents_tenant_idx').on(table.tenantScope),
  ]
)
