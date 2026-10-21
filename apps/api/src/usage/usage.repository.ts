import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { usageDaily } from '@/database/schema'

export type UsageRollupDelta = {
  tenantId: string
  day: string
  metric: string
  detail: string
  value: number
}

export type UsageDailyRow = typeof usageDaily.$inferSelect

export const usageRepository = {
  /** Add deltas to their daily rows in one D1 batch (upsert, summing `value`). */
  async addDailyDeltas(db: Database, deltas: UsageRollupDelta[], now = new Date()): Promise<void> {
    if (deltas.length === 0) return
    const updatedAt = now.toISOString()
    const statements = deltas.map((delta) =>
      db
        .insert(usageDaily)
        .values({ ...delta, updatedAt })
        .onConflictDoUpdate({
          target: [usageDaily.tenantId, usageDaily.day, usageDaily.metric, usageDaily.detail],
          set: { value: sql`${usageDaily.value} + ${delta.value}`, updatedAt },
        })
    )
    const [first, ...rest] = statements
    await db.batch([first!, ...rest])
  },

  /** Daily rows for one tenant and day (for host reporting and tests). */
  async findDaily(db: Database, tenantId: string, day: string): Promise<UsageDailyRow[]> {
    return db
      .select()
      .from(usageDaily)
      .where(and(eq(usageDaily.tenantId, tenantId), eq(usageDaily.day, day)))
  },
}
