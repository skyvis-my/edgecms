import { and, eq } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { permissions, roles } from '@/database/schema'

/** Row type inferred from the roles table. */
export type RoleRow = typeof roles.$inferSelect

/** Insert type inferred from the roles table. */
export type RoleInsert = typeof roles.$inferInsert

/** Row type inferred from the permissions table. */
export type PermissionRow = typeof permissions.$inferSelect

/** Insert type inferred from the permissions table. */
export type PermissionInsert = typeof permissions.$inferInsert

/** New role input type. */
export type NewRole = RoleInsert

/** New permission input type. */
export type NewPermission = PermissionInsert

/**
 * Data access layer for RBAC roles and permissions.
 *
 * Provides CRUD operations for custom roles and their granular permissions.
 */
export const rbacRepository = {
  /** List all roles for a tenant. */
  async findRolesByTenant(db: Database, tenantId: string): Promise<RoleRow[]> {
    return await db.select().from(roles).where(eq(roles.tenantId, tenantId)).all()
  },

  /** Find a role by its primary key. */
  async findRoleById(db: Database, roleId: string): Promise<RoleRow | undefined> {
    const rows = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1)
    return rows[0]
  },

  /** Find a role by its primary key within a tenant. */
  async findRoleByTenantAndId(
    db: Database,
    tenantId: string,
    roleId: string
  ): Promise<RoleRow | undefined> {
    const rows = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)))
      .limit(1)
    return rows[0]
  },

  /** Find a role by tenant ID and name. */
  async findRoleByTenantAndName(
    db: Database,
    tenantId: string,
    name: string
  ): Promise<RoleRow | undefined> {
    const rows = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.name, name)))
      .limit(1)
    return rows[0]
  },

  /** List all permissions for a role. */
  async findPermissionsByRole(db: Database, roleId: string): Promise<PermissionRow[]> {
    return await db.select().from(permissions).where(eq(permissions.roleId, roleId)).all()
  },

  /** Insert a new role row. */
  async createRole(db: Database, role: NewRole): Promise<RoleRow> {
    const rows = await db.insert(roles).values(role).returning()
    const row = rows[0]
    if (!row) {
      throw new Error('Failed to create role: insert returned no rows')
    }
    return row
  },

  /** Insert a new permission row. */
  async createPermission(db: Database, permission: NewPermission): Promise<PermissionRow> {
    const rows = await db.insert(permissions).values(permission).returning()
    const row = rows[0]
    if (!row) {
      throw new Error('Failed to create permission: insert returned no rows')
    }
    return row
  },

  /** Update an existing role by tenant and ID. Returns the updated row or undefined if not found. */
  async updateRole(
    db: Database,
    tenantId: string,
    roleId: string,
    updates: Partial<Omit<RoleRow, 'id' | 'tenantId'>>
  ): Promise<RoleRow | undefined> {
    const rows = await db
      .update(roles)
      .set(updates)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)))
      .returning()
    return rows[0]
  },

  /** Delete a role by tenant and ID. Returns true if a row was deleted. */
  async deleteRole(db: Database, tenantId: string, roleId: string): Promise<boolean> {
    const rows = await db
      .delete(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)))
      .returning({ id: roles.id })
    return rows.length > 0
  },

  /** Delete a permission by ID. Returns true if a row was deleted. */
  async deletePermission(db: Database, permissionId: string): Promise<boolean> {
    const rows = await db
      .delete(permissions)
      .where(eq(permissions.id, permissionId))
      .returning({ id: permissions.id })
    return rows.length > 0
  },
}
