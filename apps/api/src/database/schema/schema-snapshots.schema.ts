import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const schemaSnapshots = sqliteTable(
  'schema_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('global'),
    schemaVersion: integer('schema_version').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('schema_snapshots_tenant_version_unique').on(table.tenantId, table.schemaVersion),
  ]
)
