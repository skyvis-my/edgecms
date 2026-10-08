import { desc, eq } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { schemaSnapshots } from '@/database/schema'

export type SchemaSnapshotRow = typeof schemaSnapshots.$inferSelect

export const schemaSnapshotsRepository = {
  async findLatestSnapshot(
    db: Database,
    tenantId: string
  ): Promise<SchemaSnapshotRow | undefined> {
    const rows = await db
      .select()
      .from(schemaSnapshots)
      .where(eq(schemaSnapshots.tenantId, tenantId))
      .orderBy(desc(schemaSnapshots.schemaVersion))
      .limit(1)
    return rows[0]
  },

  async createSnapshot(
    db: Database,
    values: {
      tenantId: string
      schemaVersion: number
      payload: Record<string, unknown>
    }
  ): Promise<void> {
    await db.insert(schemaSnapshots).values({
      id: crypto.randomUUID(),
      tenantId: values.tenantId,
      schemaVersion: values.schemaVersion,
      payload: values.payload,
      createdAt: new Date().toISOString(),
    })
  },
}
