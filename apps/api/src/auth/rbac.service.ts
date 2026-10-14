import type { Database } from '@/database/db'
import type { ServiceResult } from '@/shared/types/result'
import { permissions, roles } from '@/database/schema'
import {
  BUILTIN_PERMISSIONS,
  buildBuiltInSeedRows,
  type BuiltInRoleName,
} from './builtin-roles'
import { rbacRepository } from './rbac.repository'

/** Custom role input for creation. */
export type { BuiltInRoleName } from './builtin-roles'
export interface CreateRoleInput {
  name: string
  description?: string
  baseRole?: BuiltInRoleName
  permissions?: Array<{ subject: string; action: string }>
}

/** Role with permission count for list views. */
export type RoleWithPermissionCount = RoleRow & { permissionCount: number }

// Import types from repository
type RoleRow = import('./rbac.repository').RoleRow

/** D1 batch capability probe (mock drivers lack .batch). Call as a method to preserve `this`. */
function batchCapable(db: Database) {
  return db as unknown as {
    batch?: (queries: Parameters<Database['batch']>[0]) => ReturnType<Database['batch']>
  }
}
const PERMS_CACHE_TTL_MS = 60_000
// Per-DB cache (WeakMap): a module-level Map keyed by tenant:role leaks across
// test mock DBs and across tenants sharing a process. Scope to the db instance.
const permsCache = new WeakMap<
  object,
  Map<string, { expiresAt: number; perms: Array<{ subject: string; action: string; conditions?: string | null }> }>
>()

/**
 * Business logic layer for RBAC.
 *
 * Orchestrates repository calls with validation, built-in role seeding,
 * and permission resolution.
 */
export const rbacService = {
  /**
   * Seed built-in roles for a new tenant.
   * Should be called after tenant creation.
   *
   * Fast path: when no roles exist yet and the driver supports db.batch(),
   * all 4 roles + 22 permissions go in a single round-trip. Otherwise falls
   * back to the per-role check-then-insert loop (idempotent re-seed heal).
   */
  async seedBuiltInRoles(db: Database, tenantId: string): Promise<void> {
    const batched = batchCapable(db)
    if (typeof batched.batch === 'function' && typeof rbacRepository.findRolesByTenant === 'function') {
      const existing = await rbacRepository.findRolesByTenant(db, tenantId)
      if (existing.length === 0) {
        const now = new Date().toISOString()
        const { roleRows, permRows } = buildBuiltInSeedRows(tenantId, now)
        try {
          await batched.batch([db.insert(roles).values(roleRows), db.insert(permissions).values(permRows)])
          return
        } catch (err) {
          // UNIQUE race (concurrent seed won): fall through to per-role heal.
          if (!(err instanceof Error) || !/unique|UNIQUE|SQLITE_CONSTRAINT/i.test(err.message)) {
            throw err
          }
        }
      } else if (existing.length >= 4) {
        return
      }
    }

    const now = new Date().toISOString()
    const roleNames: BuiltInRoleName[] = ['viewer', 'editor', 'admin', 'owner']
    const roleDescriptions: Record<BuiltInRoleName, string> = {
      viewer: 'Can read content only',
      editor: 'Can create, edit, and publish content',
      admin: 'Can manage all content and users',
      owner: 'Full access to all resources',
    }

    for (const roleName of roleNames) {
      const existing = await rbacRepository.findRoleByTenantAndName(db, tenantId, roleName)
      if (existing) continue

      // ATM: concurrent seeds race on the check above; the
      // (tenantId, name) unique constraint arbitrates. A loser skips.
      let role
      try {
        role = await rbacRepository.createRole(db, {
          id: crypto.randomUUID(),
          tenantId,
          name: roleName,
          description: roleDescriptions[roleName],
          isDefault: roleName === 'viewer',
          createdAt: now,
          updatedAt: now,
        })
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
          continue
        }
        throw err
      }

      // Create permissions for this role in batch (with fallback for custom mocks)
      const permissions = BUILTIN_PERMISSIONS[roleName]
      if (permissions.length > 0) {
        if (typeof rbacRepository.createPermissions === 'function') {
          await rbacRepository.createPermissions(
            db,
            permissions.map((perm) => ({
              id: crypto.randomUUID(),
              roleId: role.id,
              subject: perm.subject,
              action: perm.action,
              conditions: null,
              createdAt: now,
            }))
          )
        } else {
          for (const perm of permissions) {
            await rbacRepository.createPermission(db, {
              id: crypto.randomUUID(),
              roleId: role.id,
              subject: perm.subject,
              action: perm.action,
              conditions: null,
              createdAt: now,
            })
          }
        }
      }
    }
  },

  /** List all roles for a tenant with permission counts in a single join query. */
  async getRolesForTenant(
    db: Database,
    tenantId: string
  ): Promise<ServiceResult<RoleWithPermissionCount[]>> {
    const roles = await rbacRepository.findRolesByTenant(db, tenantId)
    const countsMap =
      typeof rbacRepository.findPermissionCountsByTenant === 'function'
        ? await rbacRepository.findPermissionCountsByTenant(db, tenantId)
        : new Map<string, number>(
            await Promise.all(
              roles.map(
                async (role): Promise<[string, number]> => [
                  role.id,
                  (await rbacRepository.findPermissionsByRole(db, role.id)).length,
                ]
              )
            )
          )

    const rolesWithCounts: RoleWithPermissionCount[] = roles.map((role) => ({
      ...role,
      permissionCount: countsMap.get(role.id) ?? 0,
    }))

    return { success: true, data: rolesWithCounts }
  },

  /** Get effective permissions for a role (built-in or custom). */
  async getEffectivePermissions(
    db: Database,
    tenantId: string,
    roleName: string
  ): Promise<ServiceResult<Array<{ subject: string; action: string; conditions?: string | null }>>> {
    const cacheKey = `${tenantId}:${roleName}`
    const cached = permsCache.get(db as unknown as object)?.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return { success: true, data: cached.perms }
    }
    const role = await rbacRepository.findRoleByTenantAndName(db, tenantId, roleName)
    if (!role) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Role '${roleName}' not found for tenant` },
      }
    }

    const permissions = await rbacRepository.findPermissionsByRole(db, role.id)
    const data = permissions.map((p) => ({
      subject: p.subject,
      action: p.action,
      conditions: p.conditions,
    }))
    let scoped = permsCache.get(db as unknown as object)
    if (!scoped) {
      scoped = new Map()
      permsCache.set(db as unknown as object, scoped)
    }
    scoped.set(cacheKey, { expiresAt: Date.now() + PERMS_CACHE_TTL_MS, perms: data })
    return { success: true, data }
  },

  /** Check if a role can perform a specific action on a subject. */
  async canPerformAction(
    db: Database,
    tenantId: string,
    roleName: string,
    subject: string,
    action: string
  ): Promise<ServiceResult<boolean>> {
    const result = await this.getEffectivePermissions(db, tenantId, roleName)
    if (!result.success) return result

    const permissions = result.data
    const canPerform = permissions.some(
      (p) => this._permissionMatches(p.subject, p.action, subject, action)
    )

    return { success: true, data: canPerform }
  },

  /** Create a custom role with optional permissions. */
  async createCustomRole(
    db: Database,
    tenantId: string,
    input: CreateRoleInput
  ): Promise<ServiceResult<RoleRow>> {
    // Check for name uniqueness per tenant
    const existing = await rbacRepository.findRoleByTenantAndName(db, tenantId, input.name)
    if (existing) {
      return {
        success: false,
        error: {
          code: 'CONFLICT',
          message: `Role '${input.name}' already exists for tenant`,
        },
      }
    }

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    let role
    try {
      role = await rbacRepository.createRole(db, {
        id,
        tenantId,
        name: input.name,
        description: input.description ?? null,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      })
    } catch (err) {
      // ATM: check-then-act race on concurrent creates with the same name.
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        return {
          success: false,
          error: {
            code: 'CONFLICT',
            message: `Role '${input.name}' already exists for tenant`,
          },
        }
      }
      throw err
    }

    // Add permissions in batch if provided (with fallback for custom mocks)
    if (input.permissions && input.permissions.length > 0) {
      if (typeof rbacRepository.createPermissions === 'function') {
        await rbacRepository.createPermissions(
          db,
          input.permissions.map((perm) => ({
            id: crypto.randomUUID(),
            roleId: role.id,
            subject: perm.subject,
            action: perm.action,
            conditions: null,
            createdAt: now,
          }))
        )
      } else {
        for (const perm of input.permissions) {
          await rbacRepository.createPermission(db, {
            id: crypto.randomUUID(),
            roleId: role.id,
            subject: perm.subject,
            action: perm.action,
            conditions: null,
            createdAt: now,
          })
        }
      }
    }

    return { success: true, data: role }
  },

  /** Delete a custom role (cannot delete built-in roles). */
  async deleteCustomRole(
    db: Database,
    tenantId: string,
    roleId: string
  ): Promise<ServiceResult<{ id: string }>> {
    const role = await rbacRepository.findRoleByTenantAndId(db, tenantId, roleId)
    if (!role) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Role '${roleId}' not found` },
      }
    }

    // Prevent deletion of built-in roles
    const builtInRoles: BuiltInRoleName[] = ['viewer', 'editor', 'admin', 'owner']
    if (builtInRoles.includes(role.name as BuiltInRoleName)) {
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Cannot delete built-in role '${role.name}'`,
        },
      }
    }

    const deleted = await rbacRepository.deleteRole(db, tenantId, roleId)
    if (!deleted) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Role '${roleId}' not found` },
      }
    }

    return { success: true, data: { id: roleId } }
  },

  /** Update a role's metadata. */
  async updateRole(
    db: Database,
    tenantId: string,
    roleId: string,
    updates: { name?: string; description?: string }
  ): Promise<ServiceResult<RoleRow>> {
    const existing = await rbacRepository.findRoleByTenantAndId(db, tenantId, roleId)
    if (!existing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Role '${roleId}' not found` },
      }
    }

    // Prevent renaming built-in roles
    const builtInRoles: BuiltInRoleName[] = ['viewer', 'editor', 'admin', 'owner']
    if (builtInRoles.includes(existing.name as BuiltInRoleName) && updates.name) {
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Cannot rename built-in roles',
        },
      }
    }

    const updated = await rbacRepository.updateRole(db, tenantId, roleId, {
      ...(updates.name && { name: updates.name }),
      ...(updates.description !== undefined && { description: updates.description }),
      updatedAt: new Date().toISOString(),
    })

    if (!updated) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Role '${roleId}' not found` },
      }
    }

    return { success: true, data: updated }
  },

  /** Internal: Check if a permission matches the requested subject and action. */
  _permissionMatches(
    permSubject: string,
    permAction: string,
    requestedSubject: string,
    requestedAction: string
  ): boolean {
    // Check action match (including wildcard 'manage')
    const actionMatches =
      permAction === requestedAction ||
      permAction === 'manage' ||
      permAction === '*'

    if (!actionMatches) return false

    // Check subject match (including wildcards)
    if (permSubject === '*:*' || permSubject === requestedSubject) {
      return true
    }

    // Handle collection:* wildcard
    if (permSubject.endsWith(':*')) {
      const permPrefix = permSubject.split(':')[0]
      const requestedPrefix = requestedSubject.split(':')[0]
      if (permPrefix === requestedPrefix) {
        return true
      }
    }

    // Handle collection:slug exact match
    if (permSubject === requestedSubject) {
      return true
    }

    return false
  },
}
