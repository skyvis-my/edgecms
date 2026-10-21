import { createDb, type Database } from '@/database/db'
import type { Env } from '@/env'
import { hasSuperAdminRole, isSuperAdminEmail, parseSuperAdminEmails } from '@/auth/super-admin'
import type { TenantContext } from '@/tenants/tenant-context'
import { verifyTenantMembership } from '@/tenants/tenant-context'
import { AUDIT_GLOBAL_SCOPE } from './audit-chain'

type AuditUser = { id: string; email?: string | null; emailVerified?: boolean | null; role?: unknown }

const TENANT_AUDIT_ROLES = new Set(['owner', 'admin'])

/**
 * The audit ledger lives in the main (control-plane) D1 so one scope's chain
 * never splits across tenant-dedicated databases.
 */
export function getAuditDb(workerEnv: Pick<Env, 'DB'> | undefined, fallback: Database): Database {
  return workerEnv?.DB ? createDb(workerEnv.DB) : fallback
}

/** Super-admin by role or a verified SUPER_ADMIN_EMAILS address. Fails closed (no dev-mode bypass). */
export function isSuperAdminUser(user: AuditUser | undefined, workerEnv: Partial<Env>): boolean {
  if (!user) return false
  if (hasSuperAdminRole(user.role)) return true
  return isSuperAdminEmail(
    user.email ?? undefined,
    parseSuperAdminEmails(workerEnv.SUPER_ADMIN_EMAILS),
    user.emailVerified
  )
}

export type AuditScopeAccess =
  | { allowed: true; scope: string }
  | { allowed: false; status: 401 | 403; code: 'UNAUTHORIZED' | 'FORBIDDEN'; message: string }

/**
 * Who may read a chain: tenant owners/admins (and super-admins) for a tenant
 * scope; only super-admins for the global scope. The scope always comes from
 * the resolved tenant context, never from request input.
 */
export async function resolveAuditScopeAccess(input: {
  user: AuditUser | undefined
  tenantCtx: TenantContext | undefined
  workerEnv: Partial<Env>
  db: Database
}): Promise<AuditScopeAccess> {
  const { user, tenantCtx, workerEnv, db } = input
  if (!user?.id) {
    return { allowed: false, status: 401, code: 'UNAUTHORIZED', message: 'Authentication required' }
  }
  const superAdmin = isSuperAdminUser(user, workerEnv)

  if (!tenantCtx?.tenant) {
    return superAdmin
      ? { allowed: true, scope: AUDIT_GLOBAL_SCOPE }
      : { allowed: false, status: 403, code: 'FORBIDDEN', message: 'Super-admin access required' }
  }

  if (superAdmin) return { allowed: true, scope: tenantCtx.tenant.id }

  const role = await verifyTenantMembership(db, user.id, tenantCtx.tenant.id)
  if (role && TENANT_AUDIT_ROLES.has(role)) {
    return { allowed: true, scope: tenantCtx.tenant.id }
  }
  return {
    allowed: false,
    status: 403,
    code: 'FORBIDDEN',
    message: 'Tenant owner or admin access required',
  }
}
