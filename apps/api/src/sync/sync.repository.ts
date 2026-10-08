import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { changeLog } from '@/database/schema'

export type SyncChangeRow = typeof changeLog.$inferSelect

export const syncRepository = {
  async findChangesAfterCursor(
    db: Database,
    params: { cursor: number; limit: number; tenantScope?: string; includeAllTenants?: boolean }
  ): Promise<SyncChangeRow[]> {
    const { cursor, limit, tenantScope, includeAllTenants = false } = params

    return db
      .select()
      .from(changeLog)
      .where(
        includeAllTenants
          ? gt(changeLog.sequence, cursor)
          : tenantScope
            ? and(gt(changeLog.sequence, cursor), eq(changeLog.tenantScope, tenantScope))
            : and(gt(changeLog.sequence, cursor), isNull(changeLog.tenantScope))
      )
      .orderBy(changeLog.sequence)
      .limit(limit + 1)
  },

  async findExistingChangeLogEntry(
    db: Database,
    params: { entityType: string; entityId: string; tenantScope?: string }
  ): Promise<{ id: string } | undefined> {
    const rows = await db
      .select({ id: changeLog.id })
      .from(changeLog)
      .where(
        and(
          eq(changeLog.entityType, params.entityType),
          eq(changeLog.entityId, params.entityId),
          params.tenantScope
            ? eq(changeLog.tenantScope, params.tenantScope)
            : isNull(changeLog.tenantScope)
        )
      )
      .limit(1)
    return rows[0]
  },

  async insertChangeLogEntry(
    db: Database,
    values: typeof changeLog.$inferInsert
  ): Promise<void> {
    await db.insert(changeLog).values(values)
  },
}
