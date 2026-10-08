import { and, count, eq } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { tenantUsers, user } from '@/database/schema'

export type AdminUserListingRow = {
  id: string
  name: string
  email: string
  createdAt: Date | string | number | null
  updatedAt: Date | string | number | null
  globalRole: string | null
  tenantRole: string | null
}

export const usersRepository = {
  async findForAdminListing(db: Database, tenantId?: string): Promise<AdminUserListingRow[]> {
    const selection = {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      globalRole: user.role,
      tenantRole: tenantUsers.role,
    }

    if (tenantId) {
      return db
        .select(selection)
        .from(user)
        .innerJoin(
          tenantUsers,
          and(eq(tenantUsers.userId, user.id), eq(tenantUsers.tenantId, tenantId))
        )
        .all()
    }

    return db
      .select(selection)
      .from(user)
      .leftJoin(tenantUsers, eq(tenantUsers.userId, user.id))
      .all()
  },

  async findRoleById(db: Database, userId: string): Promise<string | undefined> {
    const rows = await db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1)
    return rows[0]?.role ?? undefined
  },

  async findFirstUserId(db: Database): Promise<string | undefined> {
    const rows = await db.select({ id: user.id }).from(user).orderBy(user.createdAt).limit(1)
    return rows[0]?.id ?? undefined
  },

  async countAll(db: Database): Promise<number> {
    const rows = await db.select({ value: count(user.id) }).from(user)
    const value = rows[0]?.value
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  },
}
