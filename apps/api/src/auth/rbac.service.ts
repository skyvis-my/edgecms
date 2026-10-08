import type { Database } from '@/database/db'
import type { ServiceResult } from '@/shared/types/result'
import { rbacRepository } from './rbac.repository'

/** Built-in role names. */
export type BuiltInRoleName = 'viewer' | 'editor' | 'admin' | 'owner'

/** Custom role input for creation. */
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

/** Built-in permissions for each role. */
const BUILTIN_PERMISSIONS: Record<BuiltInRoleName, Array<{ subject: string; action: string }>> = {
  viewer: [
    { subject: 'collection:*', action: 'read' },
    { subject: 'entry:*', action: 'read' },
    { subject: 'asset:*', action: 'read' },
  ],
  editor: [
    { subject: 'collection:*', action: 'read' },
    { subject: 'entry:*', action: 'read' },
    { subject: 'entry:*', action: 'create' },
    { subject: 'entry:*', action: 'update' },
    { subject: 'entry:*', action: 'delete' },
    { subject: 'entry:*', action: 'publish' },
    { subject: 'asset:*', action: 'read' },
    { subject: 'asset:*', action: 'create' },
    { subject: 'asset:*', action: 'update' },
    { subject: 'asset:*', action: 'delete' },
  ],
  admin: [
    { subject: 'collection:*', action: 'manage' },
    { subject: 'entry:*', action: 'manage' },
    { subject: 'asset:*', action: 'manage' },
    { subject: 'user:*', action: 'read' },
    { subject: 'user:*', action: 'create' },
    { subject: 'user:*', action: 'update' },
    { subject: 'settings:*', action: 'manage' },
    { subject: 'webhooks:*', action: 'manage' },
  ],
  owner: [
    { subject: '*:*', action: 'manage' },
  ],
}

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
   */
  async seedBuiltInRoles(db: Database, tenantId: string): Promise<void> {
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

      const role = await rbacRepository.createRole(db, {
        id: crypto.randomUUID(),
        tenantId,
        name: roleName,
        description: roleDescriptions[roleName],
        isDefault: roleName === 'viewer',
        createdAt: now,
        updatedAt: now,
      })

      // Create permissions for this role
      const permissions = BUILTIN_PERMISSIONS[roleName]
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
  },

  /** List all roles for a tenant with permission counts. */
  async getRolesForTenant(
    db: Database,
    tenantId: string
  ): Promise<ServiceResult<RoleWithPermissionCount[]>> {
    const roles = await rbacRepository.findRolesByTenant(db, tenantId)
    const rolesWithCounts: RoleWithPermissionCount[] = []

    for (const role of roles) {
      const permissions = await rbacRepository.findPermissionsByRole(db, role.id)
      rolesWithCounts.push({
        ...role,
        permissionCount: permissions.length,
      })
    }

    return { success: true, data: rolesWithCounts }
  },

  /** Get effective permissions for a role (built-in or custom). */
  async getEffectivePermissions(
    db: Database,
    tenantId: string,
    roleName: string
  ): Promise<ServiceResult<Array<{ subject: string; action: string; conditions?: string | null }>>> {
    const role = await rbacRepository.findRoleByTenantAndName(db, tenantId, roleName)
    if (!role) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Role '${roleName}' not found for tenant` },
      }
    }

    const permissions = await rbacRepository.findPermissionsByRole(db, role.id)
    return {
      success: true,
      data: permissions.map((p) => ({
        subject: p.subject,
        action: p.action,
        conditions: p.conditions,
      })),
    }
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

    const role = await rbacRepository.createRole(db, {
      id,
      tenantId,
      name: input.name,
      description: input.description ?? null,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    })

    // Add permissions if provided
    if (input.permissions && input.permissions.length > 0) {
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
