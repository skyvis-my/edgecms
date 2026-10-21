import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Daily usage rollups (HS-05). Written only by the opt-in D1 rollup sink
 * (`createD1UsageRollupSink`); the default host sink writes nothing.
 *
 * One row per tenant, UTC day, metric and detail (the AI model tier for
 * `ai_tokens`, empty otherwise). `value` is the sum of the day's deltas, so
 * `media_bytes` and `entries` can be negative on a day with more deletes.
 */
export const usageDaily = sqliteTable(
  'usage_daily',
  {
    tenantId: text('tenant_id').notNull(),
    /** UTC date, `YYYY-MM-DD`. */
    day: text('day').notNull(),
    metric: text('metric').notNull(),
    detail: text('detail').notNull().default(''),
    value: integer('value').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.day, table.metric, table.detail] })]
)
