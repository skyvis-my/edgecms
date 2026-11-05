import { sql, type SQL } from 'drizzle-orm'

/**
 * HS-09 tenant data map: every table in the D1 schema, classified.
 *
 * - `tenant`: the row belongs to a tenant through `column`.
 * - `child`: the row belongs to a tenant through its parent row
 *   (`column` → `parent.parentColumn`).
 * - `cache_tags`: snapshot tag rows; a snapshot belongs to a tenant when one
 *   of its tags starts with `t:<tenantId>:`.
 * - `root`: the `tenants` row itself, deleted last.
 * - `global` / `retained`: never deleted with a tenant, with the reason.
 *
 * `TENANT_DELETION_ORDER` is the order rows are deleted: children before
 * parents, so foreign-key cascades never remove rows before they are counted.
 * `tenant-data-map.test.ts` fails when a migration adds a table that is not
 * listed here, when a table with a tenant column is classified as global, or
 * when the order breaks a foreign key.
 */
export type TenantScopedRule =
  | { table: string; kind: 'tenant'; column: string }
  | { table: string; kind: 'child'; column: string; parent: string; parentColumn: string }
  | { table: string; kind: 'cache_tags' }
  | { table: string; kind: 'root' }

export type UnscopedRule = { table: string; kind: 'global' | 'retained'; reason: string }

export type TenantTableRule = TenantScopedRule | UnscopedRule

/** Deletion order. The `tenants` row is last. */
export const TENANT_DELETION_ORDER: readonly TenantScopedRule[] = [
  // Content: versions, search rows and relations before entries; entries before collections.
  { table: 'entry_versions', kind: 'child', column: 'entryId', parent: 'entries', parentColumn: 'id' },
  { table: 'entries_fts', kind: 'tenant', column: 'tenant_id' },
  { table: 'relations', kind: 'tenant', column: 'tenantId' },
  { table: 'schedule_intents', kind: 'tenant', column: 'tenant_scope' },
  {
    table: 'entries',
    kind: 'child',
    column: 'collectionId',
    parent: 'collections',
    parentColumn: 'id',
  },
  { table: 'collections', kind: 'tenant', column: 'tenantId' },
  { table: 'schema_snapshots', kind: 'tenant', column: 'tenant_id' },
  { table: 'cache_tags', kind: 'cache_tags' },
  // Media metadata (R2 objects are queued for deletion before these rows go).
  { table: 'asset_variants', kind: 'child', column: 'asset_id', parent: 'assets', parentColumn: 'id' },
  { table: 'assets', kind: 'tenant', column: 'tenant_id' },
  // AI imports: leaves first.
  { table: 'ai_suggestions', kind: 'tenant', column: 'tenant_id' },
  { table: 'ai_suggestion_sets', kind: 'tenant', column: 'tenant_id' },
  { table: 'ai_import_sources', kind: 'tenant', column: 'tenant_id' },
  { table: 'ai_tool_invocations', kind: 'tenant', column: 'tenant_id' },
  { table: 'ai_import_batches', kind: 'tenant', column: 'tenant_id' },
  // Webhooks.
  {
    table: 'webhook_deliveries',
    kind: 'child',
    column: 'webhook_id',
    parent: 'webhooks',
    parentColumn: 'id',
  },
  { table: 'webhooks', kind: 'tenant', column: 'tenant_id' },
  { table: 'webhook_outbox', kind: 'tenant', column: 'tenant_scope' },
  // Command log and sync feed (change_log and audit_log reference commands).
  { table: 'change_log', kind: 'tenant', column: 'tenantScope' },
  {
    table: 'audit_log',
    kind: 'child',
    column: 'commandId',
    parent: 'processed_commands',
    parentColumn: 'id',
  },
  { table: 'processed_commands', kind: 'tenant', column: 'tenantScope' },
  { table: 'usage_daily', kind: 'tenant', column: 'tenant_id' },
  // Access and registry rows.
  { table: 'permissions', kind: 'child', column: 'role_id', parent: 'roles', parentColumn: 'id' },
  { table: 'roles', kind: 'tenant', column: 'tenant_id' },
  { table: 'signup_invites', kind: 'tenant', column: 'tenantId' },
  { table: 'tenant_users', kind: 'tenant', column: 'tenantId' },
  { table: 'tenant_resources', kind: 'tenant', column: 'tenantId' },
  { table: 'tenants', kind: 'root' },
]

/** Tables that are not deleted with a tenant. */
export const TENANT_UNSCOPED_TABLES: readonly UnscopedRule[] = [
  { table: 'user', kind: 'global', reason: 'Accounts are global; HS-13 deletes a person.' },
  { table: 'session', kind: 'global', reason: 'Belongs to a user account (HS-13).' },
  { table: 'account', kind: 'global', reason: 'Belongs to a user account (HS-13).' },
  { table: 'verification', kind: 'global', reason: 'Belongs to a user account (HS-13).' },
  { table: 'twoFactor', kind: 'global', reason: 'Belongs to a user account (HS-13).' },
  {
    table: 'audit_events',
    kind: 'retained',
    reason: 'HS-12 tamper-evident ledger; the tenant chain ages out under the retention policy.',
  },
  {
    table: 'r2_gc_outbox',
    kind: 'retained',
    reason: 'Holds the queued R2 deletes for this tenant until the sweeper drains them.',
  },
  {
    table: 'tenant_deletion_jobs',
    kind: 'retained',
    reason: 'The offboarding record and its counts must outlive the tenant.',
  },
]

export const TENANT_TABLE_RULES: readonly TenantTableRule[] = [
  ...TENANT_DELETION_ORDER,
  ...TENANT_UNSCOPED_TABLES,
]

const RULES_BY_TABLE = new Map(TENANT_DELETION_ORDER.map((rule) => [rule.table, rule]))

/** Tenant id prefix of snapshot cache tags (see snapshotService.generateCacheTags). */
export function tenantCacheTagPrefix(tenantId: string): string {
  return `t:${tenantId}:`
}

/**
 * SQL condition selecting a table's rows that belong to `tenantId`.
 * Column names are unqualified, so the condition is valid inside
 * `SELECT ... FROM <table> WHERE <condition>`.
 */
export function tenantScopeCondition(table: string, tenantId: string, depth = 0): SQL {
  const rule = RULES_BY_TABLE.get(table)
  if (!rule) throw new Error(`Table '${table}' is not tenant-scoped`)
  if (depth > 4) throw new Error(`Tenant scope for '${table}' nests too deeply`)
  switch (rule.kind) {
    case 'root':
      return sql`${sql.identifier('id')} = ${tenantId}`
    case 'tenant':
      return sql`${sql.identifier(rule.column)} = ${tenantId}`
    case 'child':
      return sql`${sql.identifier(rule.column)} IN (SELECT ${sql.identifier(rule.parentColumn)} FROM ${sql.identifier(rule.parent)} WHERE ${tenantScopeCondition(rule.parent, tenantId, depth + 1)})`
    case 'cache_tags': {
      const prefix = tenantCacheTagPrefix(tenantId)
      return sql`${sql.identifier('snapshotKey')} IN (SELECT ${sql.identifier('snapshotKey')} FROM ${sql.identifier('cache_tags')} WHERE substr(${sql.identifier('tag')}, 1, ${prefix.length}) = ${prefix})`
    }
  }
}
