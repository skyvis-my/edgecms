import { and, eq, sql } from 'drizzle-orm'
import { createAuthorizationAbility, type DbPermission } from '@/auth/authorization'
import { BUILTIN_PERMISSIONS } from '@/auth/builtin-roles'
import { asTenantActorRole, type TenantActorRole } from '@/auth/rbac'
import { rbacRepository } from '@/auth/rbac.repository'
import { rbacService } from '@/auth/rbac.service'
import { hasSuperAdminRole } from '@/auth/super-admin'
import type { Database } from '@/database/db'
import { tenantUsers } from '@/database/schema'
import type { ServiceResult } from '@/shared/types/result'
import { tenantsRepository } from '@/tenants/tenants.repository'

export type MemberRoleChange = {
  tenantId: string
  userId: string
  role: string
  previousRole: string
  roleKind: 'builtin' | 'custom'
  changed: boolean
}

export type AssignMemberRoleInput = {
  tenantId: string
  caller: { userId: string; isSuperAdmin: boolean }
  targetUserId: string
  role: string
}

/**
 * What a caller's own grants are, for escalation checks:
 * - `super`/`owner`: may assign any role.
 * - `admin`: may not grant owner or change an owner.
 * - `delegate`: a custom role with an explicit `TenantAdminRoles` grant; may
 *   only assign roles whose grants it holds itself (see `isCoveredBy`).
 */
type Authority =
  | { kind: 'super' | 'owner' | 'admin' }
  | { kind: 'delegate'; permissions: DbPermission[] }

/**
 * Grants a built-in role has at the guard, expressed as stored permissions so
 * a delegate's grants can be compared. Viewers get no admin abilities; members
 * read every collection (see `authorization.ts`).
 */
const BUILTIN_EFFECTIVE_GRANTS: Record<'viewer' | 'member' | 'editor', DbPermission[]> = {
  viewer: [],
  member: [{ subject: 'entry:*', action: 'read' }],
  editor: BUILTIN_PERMISSIONS.editor,
}

function forbidden(message: string): ServiceResult<never> {
  return { success: false, error: { code: 'FORBIDDEN', message } }
}

/** True when every grant in `wanted` is matched by a grant in `held`. */
function isCoveredBy(wanted: DbPermission[], held: DbPermission[]): boolean {
  return wanted.every((perm) =>
    held.some((own) => rbacService._permissionMatches(own.subject, own.action, perm.subject, perm.action))
  )
}

async function loadRolePermissions(db: Database, tenantId: string, roleName: string): Promise<DbPermission[]> {
  const result = await rbacService.getEffectivePermissions(db, tenantId, roleName)
  return result.success ? result.data : []
}

/** Effective grants of a role name (owner/admin are never compared: callers refuse them first). */
async function grantsOf(db: Database, tenantId: string, roleName: string): Promise<DbPermission[]> {
  const builtIn = asTenantActorRole(roleName)
  if (builtIn === 'viewer' || builtIn === 'member' || builtIn === 'editor') {
    return BUILTIN_EFFECTIVE_GRANTS[builtIn]
  }
  if (builtIn) return [{ subject: '*:*', action: 'manage' }]
  return loadRolePermissions(db, tenantId, roleName)
}

async function resolveAuthority(
  db: Database,
  tenantId: string,
  caller: AssignMemberRoleInput['caller']
): Promise<Authority | null> {
  if (caller.isSuperAdmin) return { kind: 'super' }
  const membership = await tenantsRepository.findTenantUser(db, tenantId, caller.userId)
  if (!membership) return null
  const builtIn = asTenantActorRole(membership.role)
  if (builtIn === 'owner' || builtIn === 'admin') return { kind: builtIn }
  if (builtIn) return null
  const permissions = await loadRolePermissions(db, tenantId, membership.role)
  const ability = createAuthorizationAbility({ actorId: caller.userId }, permissions)
  return ability.can('manage', 'TenantAdminRoles') ? { kind: 'delegate', permissions } : null
}

/**
 * PL-03: set a tenant member's role to a built-in role or an existing custom
 * role of the same tenant.
 *
 * Rules: the role must exist in this tenant (P2); only owners and super-admins
 * grant `owner` or change an owner; a delegate cannot touch admins, owners or
 * itself and cannot hand out grants it lacks; the last owner cannot be
 * demoted. The write is a single guarded UPDATE (compare-and-set on the
 * previous role plus an owner count), so concurrent demotions cannot remove
 * the last owner.
 */
export async function assignMemberRole(
  db: Database,
  input: AssignMemberRoleInput
): Promise<ServiceResult<MemberRoleChange>> {
  const { tenantId, caller, targetUserId } = input
  const role = input.role.trim()

  // Caller first, so a caller without role rights learns nothing about role names.
  const authority = await resolveAuthority(db, tenantId, caller)
  if (!authority) return forbidden('Tenant owner or admin access required')

  if (role.length === 0 || hasSuperAdminRole(role)) {
    return { success: false, error: { code: 'VALIDATION_ERROR', message: 'Role is not assignable' } }
  }
  const builtIn: TenantActorRole | undefined = asTenantActorRole(role)
  if (!builtIn) {
    const customRole = await rbacRepository.findRoleByTenantAndName(db, tenantId, role)
    if (!customRole) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `Role '${role}' does not exist in this tenant` },
      }
    }
  }
  const roleKind = builtIn ? 'builtin' : 'custom'

  const target = await tenantsRepository.findTenantUser(db, tenantId, targetUserId)
  if (!target) {
    return { success: false, error: { code: 'NOT_FOUND', message: 'User is not a member of this tenant' } }
  }
  const previousRole = target.role

  const canManageOwners = authority.kind === 'super' || authority.kind === 'owner'
  if (role === 'owner' && !canManageOwners) return forbidden('Only an owner can grant the owner role')
  if (previousRole === 'owner' && !canManageOwners) {
    return forbidden("Only an owner can change an owner's role")
  }
  if (authority.kind === 'delegate') {
    if (targetUserId === caller.userId) return forbidden('You cannot change your own role')
    if (role === 'admin' || previousRole === 'admin') {
      return forbidden('Only an owner or admin can grant or change the admin role')
    }
    // Both the new role and the member's current role must stay within the
    // delegate's own grants: no handing out, and no taking away, more than it holds.
    for (const name of [role, previousRole]) {
      if (!isCoveredBy(await grantsOf(db, tenantId, name), authority.permissions)) {
        return forbidden('You can only manage roles whose permissions you hold')
      }
    }
  }

  if (previousRole === role) {
    return { success: true, data: { tenantId, userId: targetUserId, role, previousRole, roleKind, changed: false } }
  }

  const updated = await db
    .update(tenantUsers)
    .set({ role })
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.userId, targetUserId),
        eq(tenantUsers.role, previousRole),
        sql`(${tenantUsers.role} <> 'owner' or (select count(*) from tenant_users as owners where owners.tenantId = ${tenantId} and owners.role = 'owner') > 1)`
      )
    )
    .returning({ role: tenantUsers.role })

  if (updated.length === 0) {
    const current = await tenantsRepository.findTenantUser(db, tenantId, targetUserId)
    if (!current) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'User is not a member of this tenant' } }
    }
    if (current.role !== previousRole) {
      return { success: false, error: { code: 'CONFLICT', message: 'The role changed meanwhile; reload and retry' } }
    }
    return {
      success: false,
      error: { code: 'LAST_OWNER', message: 'A tenant must keep at least one owner' },
    }
  }

  return { success: true, data: { tenantId, userId: targetUserId, role, previousRole, roleKind, changed: true } }
}
