import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const schemaSnapshots = sqliteTable(
  'schema_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('global'),
    schemaVersion: integer('schema_version').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('schema_snapshots_tenant_created_at_idx').on(table.tenantId, table.createdAt)]
)
