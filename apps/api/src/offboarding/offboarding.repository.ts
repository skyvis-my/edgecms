import { and, asc, eq, gt, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { AUDIT_GLOBAL_SCOPE } from '@/audit/audit-chain'
import type { Database } from '@/database/db'
import {
  auditEvents,
  tenantDeletionJobs,
  tenantResources,
  tenants,
  type TenantDeletionJobRow,
} from '@/database/schema'
import { tenantScopeCondition } from './tenant-data-map'

/** Rows removed per delete statement; small enough for D1 statement limits. */
export const DELETE_CHUNK_SIZE = 500

export const TENANT_EXPORT_ACTION = 'tenant.data_exported'

type BatchableDb = { batch: (queries: unknown[]) => Promise<unknown[]> }

/** Rows-changed count across D1 (`meta.changes`) and bun:sqlite (`changes`) results. */
function changesOf(result: unknown): number {
  const value = result as { changes?: unknown; meta?: { changes?: unknown } } | undefined
  const changes = value?.meta?.changes ?? value?.changes
  return typeof changes === 'number' ? changes : 0
}

/**
 * Run raw statements in order, atomically through D1 `batch()` when the driver
 * has it. Statements may use SQLite `changes()` to read the row count of the
 * statement before them (same connection, same transaction).
 */
async function runInOrder(db: Database, statements: SQL[]): Promise<number[]> {
  const batch = (db as unknown as Partial<BatchableDb>).batch
  if (typeof batch === 'function') {
    const results = await batch.call(
      db,
      statements.map((statement) => db.run(statement))
    )
    return results.map(changesOf)
  }
  const changes: number[] = []
  for (const statement of statements) {
    changes.push(changesOf(await db.run(statement)))
  }
  return changes
}

const jobsTable = sql.identifier('tenant_deletion_jobs')

function addCount(jobId: string, key: string, now: string): SQL {
  const path = `$."${key}"`
  return sql`UPDATE ${jobsTable} SET "counts" = json_set("counts", ${path}, coalesce(json_extract("counts", ${path}), 0) + changes()), "updated_at" = ${now} WHERE "id" = ${jobId}`
}

function addR2Queued(jobId: string): SQL {
  return sql`UPDATE ${jobsTable} SET "r2_objects_queued" = "r2_objects_queued" + changes() WHERE "id" = ${jobId}`
}

/** Shared-mode R2 prefix every tenant object key starts with (see r2-keys.ts). */
export function tenantR2Prefix(tenantId: string): string {
  return `tenants/${tenantId}/`
}

export const offboardingRepository = {
  async findTenant(db: Database, idOrSlug: string) {
    const rows = await db
      .select()
      .from(tenants)
      .where(or(eq(tenants.id, idOrSlug), eq(tenants.slug, idOrSlug)))
      .limit(1)
    return rows[0] ?? null
  },

  async findResources(db: Database, tenantId: string) {
    const rows = await db
      .select()
      .from(tenantResources)
      .where(eq(tenantResources.tenantId, tenantId))
      .limit(1)
    return rows[0] ?? null
  },

  async findJob(db: Database, jobId: string): Promise<TenantDeletionJobRow | null> {
    const rows = await db
      .select()
      .from(tenantDeletionJobs)
      .where(eq(tenantDeletionJobs.id, jobId))
      .limit(1)
    return rows[0] ?? null
  },

  async findOpenJob(db: Database, tenantId: string): Promise<TenantDeletionJobRow | null> {
    const rows = await db
      .select()
      .from(tenantDeletionJobs)
      .where(
        and(
          eq(tenantDeletionJobs.tenantId, tenantId),
          sql`${tenantDeletionJobs.status} IN ('requested', 'confirmed')`
        )
      )
      .limit(1)
    return rows[0] ?? null
  },

  async insertJob(db: Database, row: TenantDeletionJobRow): Promise<void> {
    await db.insert(tenantDeletionJobs).values(row)
  },

  /** Conditional status change; returns false when the job was not in `from`. */
  async transition(
    db: Database,
    jobId: string,
    from: string,
    patch: Partial<TenantDeletionJobRow> & { status: string }
  ): Promise<boolean> {
    const rows = await db
      .update(tenantDeletionJobs)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(and(eq(tenantDeletionJobs.id, jobId), eq(tenantDeletionJobs.status, from)))
      .returning({ id: tenantDeletionJobs.id })
    return rows.length > 0
  },

  async patchJob(db: Database, jobId: string, patch: Partial<TenantDeletionJobRow>): Promise<void> {
    await db
      .update(tenantDeletionJobs)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(tenantDeletionJobs.id, jobId))
  },

  /** Take the run lease; false while another run holds it. */
  async acquireLease(db: Database, jobId: string, now: Date, leaseMs: number): Promise<boolean> {
    const nowIso = now.toISOString()
    const rows = await db
      .update(tenantDeletionJobs)
      .set({ leaseUntil: new Date(now.getTime() + leaseMs).toISOString(), updatedAt: nowIso })
      .where(
        and(
          eq(tenantDeletionJobs.id, jobId),
          or(isNull(tenantDeletionJobs.leaseUntil), lt(tenantDeletionJobs.leaseUntil, nowIso))
        )
      )
      .returning({ id: tenantDeletionJobs.id })
    return rows.length > 0
  },

  async releaseLease(db: Database, jobId: string): Promise<void> {
    await db
      .update(tenantDeletionJobs)
      .set({ leaseUntil: null })
      .where(eq(tenantDeletionJobs.id, jobId))
  },

  /**
   * Queue every R2 object of the tenant (asset originals, variants, AI import
   * sources) plus the tenant's key prefix in the R2 GC outbox, and mark the
   * job as queued, in one D1 batch. Duplicate keys collapse on UNIQUE(object_key).
   */
  async queueR2Cleanup(db: Database, jobId: string, tenantId: string, now: string): Promise<void> {
    const outbox = sql`INSERT OR IGNORE INTO "r2_gc_outbox" ("id", "tenant_id", "object_key", "status", "attempts", "created_at")`
    const newId = sql`lower(hex(randomblob(16)))`
    await runInOrder(db, [
      sql`${outbox} SELECT ${newId}, ${tenantId}, "original_key", 'pending', 0, ${now} FROM "assets" WHERE ${tenantScopeCondition('assets', tenantId)}`,
      addR2Queued(jobId),
      sql`${outbox} SELECT ${newId}, ${tenantId}, "object_key", 'pending', 0, ${now} FROM "asset_variants" WHERE ${tenantScopeCondition('asset_variants', tenantId)}`,
      addR2Queued(jobId),
      sql`${outbox} SELECT ${newId}, ${tenantId}, "r2_object_key", 'pending', 0, ${now} FROM "ai_import_sources" WHERE "r2_object_key" IS NOT NULL AND "r2_object_key" <> '' AND ${tenantScopeCondition('ai_import_sources', tenantId)}`,
      addR2Queued(jobId),
      sql`${outbox} VALUES (${newId}, ${tenantId}, ${tenantR2Prefix(tenantId)}, 'pending', 0, ${now})`,
      sql`UPDATE ${jobsTable} SET "r2_queued_at" = ${now}, "updated_at" = ${now} WHERE "id" = ${jobId}`,
    ])
  },

  /**
   * Delete one chunk of a table's tenant rows and add the count to the job in
   * the same D1 batch, so a crash never loses or double-counts a chunk.
   * Returns the number of rows deleted.
   */
  async deleteChunk(db: Database, jobId: string, table: string, tenantId: string): Promise<number> {
    const target = sql.identifier(table)
    const [deleted] = await runInOrder(db, [
      sql`DELETE FROM ${target} WHERE rowid IN (SELECT rowid FROM ${target} WHERE ${tenantScopeCondition(table, tenantId)} LIMIT ${DELETE_CHUNK_SIZE})`,
      addCount(jobId, table, new Date().toISOString()),
    ])
    return deleted ?? 0
  },

  async countTenantRows(db: Database, table: string, tenantId: string): Promise<number> {
    const rows = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)} WHERE ${tenantScopeCondition(table, tenantId)}`
    )
    return Number(rows[0]?.n ?? 0)
  },

  /** The export receipt recorded in the global audit chain, if any. */
  async findExportReceipt(db: Database, tenantId: string, exportId: string) {
    const rows = await db
      .select({ id: auditEvents.id, occurredAt: auditEvents.occurredAt, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.scope, AUDIT_GLOBAL_SCOPE),
          eq(auditEvents.action, TENANT_EXPORT_ACTION),
          eq(auditEvents.targetId, tenantId),
          sql`json_extract(${auditEvents.metadata}, '$.exportId') = ${exportId}`
        )
      )
      .limit(1)
    return rows[0] ?? null
  },

  /** One keyset page of a table's tenant rows, ordered by `key`. */
  async exportPage<T extends SQLiteTable>(
    db: Database,
    table: T,
    tableName: string,
    key: SQLiteColumn,
    tenantId: string,
    after: string | null,
    limit: number
  ): Promise<Record<string, unknown>[]> {
    const scope = tenantScopeCondition(tableName, tenantId)
    const rows = await db
      .select()
      .from(table as SQLiteTable)
      .where(after === null ? scope : and(scope, gt(key, after)))
      .orderBy(asc(key))
      .limit(limit)
    return rows as Record<string, unknown>[]
  },
}
