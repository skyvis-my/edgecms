import { eq } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { tenants } from '@/database/schema'

/**
 * Tenant flag lookup. The tenants table lives in the main D1, so callers pass
 * the Worker env when they hold a tenant-dedicated database handle.
 */
export const aiAccessRepository = {
  async findAiEnabled(db: Database, tenantId: string): Promise<boolean | null> {
    const rows = await db
      .select({ aiEnabled: tenants.aiEnabled })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    return rows[0] ? Boolean(rows[0].aiEnabled) : null
  },

  async setAiEnabled(db: Database, tenantId: string, enabled: boolean, now: string) {
    await db
      .update(tenants)
      .set({ aiEnabled: enabled, updatedAt: now })
      .where(eq(tenants.id, tenantId))
  },
}
