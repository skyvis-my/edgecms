import { AbilityBuilder, createMongoAbility } from '@casl/ability'
import type { ActorRole, TenantActorRole } from './rbac'

export type AuthorizationAction = 'manage' | 'mutate' | 'read'
export type AuthorizationSubject =
  | 'all'
  | 'GlobalAdminApi'
  | 'TenantAdminApi'
  | 'GlobalAdminUsers'
  | 'TenantAdminUsers'
  | 'collection:*'
  | 'collection'
  | 'entry'
  | 'asset'
  | 'user'
  | 'settings'

export type AuthorizationAbility = ReturnType<typeof createAuthorizationAbility>

export type AuthorizationPrincipal = {
  actorId?: string
  actorRole?: ActorRole
  tenantRole?: TenantActorRole
  isSuperAdmin?: boolean
  isSuperAdminByEmail?: boolean
}

export type DbPermission = {
  subject: string
  action: string
  conditions?: string | null
}

type AuthorizationRequirement = {
  action: AuthorizationAction
  subject: AuthorizationSubject
  unauthenticatedMessage: string
  forbiddenMessage: string
}

type AuthorizationDecision =
  | { allowed: true }
  | {
      allowed: false
      status: 401 | 403
      code: 'UNAUTHORIZED' | 'FORBIDDEN'
      message: string
    }

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const ADMIN_MUTATION_PREFIXES = ['/api/admin/', '/api/tenants/']
const TENANT_ADMIN_PATH = /^\/api\/tenants\/[^/]+\/api\/admin(?:\/|$)/

function isTenantScopedPath(pathname: string): boolean {
  return pathname.startsWith('/api/tenants/')
}

function isGlobalAdminPath(pathname: string): boolean {
  return pathname.startsWith('/api/admin/')
}

function isTenantAdminPath(pathname: string): boolean {
  return TENANT_ADMIN_PATH.test(pathname)
}

function isAdminMutationPath(pathname: string, method: string): boolean {
  if (SAFE_METHODS.has(method)) return false
  return ADMIN_MUTATION_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isGlobalAdminUsersPath(pathname: string, method: string): boolean {
  if (method !== 'GET') return false
  return pathname === '/api/admin/users' || pathname === '/api/admin/users/'
}

function isTenantAdminUsersPath(pathname: string, method: string): boolean {
  if (method !== 'GET') return false
  return /^\/api\/tenants\/[^/]+\/api\/admin\/users\/?$/.test(pathname)
}

function resolveRequirement(
  pathname: string,
  method: string
): AuthorizationRequirement | undefined {
  if (isTenantAdminUsersPath(pathname, method)) {
    return {
      action: 'read',
      subject: 'TenantAdminUsers',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: 'Tenant admin access required',
    }
  }

  if (isGlobalAdminUsersPath(pathname, method)) {
    return {
      action: 'read',
      subject: 'GlobalAdminUsers',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: 'Admin access required',
    }
  }

  if (isAdminMutationPath(pathname, method)) {
    return {
      action: 'mutate',
      subject: isTenantScopedPath(pathname) ? 'TenantAdminApi' : 'GlobalAdminApi',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: 'Insufficient role',
    }
  }

  if (SAFE_METHODS.has(method) && isTenantAdminPath(pathname)) {
    return {
      action: 'read',
      subject: 'TenantAdminApi',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: 'Insufficient role',
    }
  }

  if (SAFE_METHODS.has(method) && isGlobalAdminPath(pathname)) {
    return {
      action: 'read',
      subject: 'GlobalAdminApi',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: 'Insufficient role',
    }
  }

  return undefined
}

export function requiresAuthorizationCheck(pathname: string, method: string): boolean {
  return resolveRequirement(pathname, method) !== undefined
}

export function createAuthorizationAbility(
  principal: AuthorizationPrincipal,
  customPermissions?: DbPermission[]
) {
  const { can, build } = new AbilityBuilder(createMongoAbility)

  if (principal.isSuperAdmin || principal.isSuperAdminByEmail) {
    can('manage', 'all')
    return build()
  }

  if (principal.actorRole === 'admin') {
    can('mutate', 'GlobalAdminApi')
    can('read', 'GlobalAdminApi')
    can('read', 'GlobalAdminUsers')
  }

  if (principal.actorRole === 'editor') {
    can('mutate', 'GlobalAdminApi')
    can('read', 'GlobalAdminApi')
  }

  if (
    principal.tenantRole === 'owner' ||
    principal.tenantRole === 'admin' ||
    principal.tenantRole === 'editor'
  ) {
    can('mutate', 'TenantAdminApi')
    can('read', 'TenantAdminApi')
  }

  if (principal.tenantRole === 'member') {
    can('read', 'TenantAdminApi')
  }

  if (principal.tenantRole === 'owner' || principal.tenantRole === 'admin') {
    can('read', 'TenantAdminUsers')
  }

  // Apply custom permissions from database
  if (customPermissions && customPermissions.length > 0) {
    for (const perm of customPermissions) {
      const subject = mapDbSubjectToAuthorizationSubject(perm.subject)
      const action = mapDbActionToAuthorizationAction(perm.action)
      if (subject && action) {
        can(action, subject)
      }
    }
  }

  return build()
}

/** Map database permission subject to authorization subject. */
function mapDbSubjectToAuthorizationSubject(dbSubject: string): AuthorizationSubject | null {
  // Direct mapping for API subjects
  if (dbSubject === 'TenantAdminApi') return 'TenantAdminApi'
  if (dbSubject === 'GlobalAdminApi') return 'GlobalAdminApi'
  if (dbSubject === '*:*' || dbSubject.startsWith('collection:*')) return 'collection:*'
  if (dbSubject.startsWith('collection:')) return 'collection'
  if (dbSubject.startsWith('entry:')) return 'entry'
  if (dbSubject.startsWith('asset:')) return 'asset'
  if (dbSubject.startsWith('user:')) return 'user'
  if (dbSubject.startsWith('settings:')) return 'settings'
  return null
}

/** Map database permission action to authorization action. */
function mapDbActionToAuthorizationAction(dbAction: string): AuthorizationAction | null {
  if (dbAction === 'manage' || dbAction === '*') return 'manage'
  if (dbAction === 'read') return 'read'
  if (dbAction === 'mutate') return 'mutate'
  if (dbAction === 'create' || dbAction === 'update' || dbAction === 'delete' || dbAction === 'publish') {
    return 'mutate'
  }
  return null
}

export function defineAbilityForPrincipal(principal: AuthorizationPrincipal): AuthorizationAbility {
  return createAuthorizationAbility(principal)
}

export function authorizeApiRequest(input: {
  pathname: string
  method: string
  principal: AuthorizationPrincipal
  customPermissions?: DbPermission[]
}): AuthorizationDecision {
  const requirement = resolveRequirement(input.pathname, input.method)
  if (!requirement) return { allowed: true }

  if (!input.principal.actorId) {
    return {
      allowed: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: requirement.unauthenticatedMessage,
    }
  }

  const ability = createAuthorizationAbility(input.principal, input.customPermissions)
  if (ability.can(requirement.action, requirement.subject)) {
    return { allowed: true }
  }

  return {
    allowed: false,
    status: 403,
    code: 'FORBIDDEN',
    message: requirement.forbiddenMessage,
  }
}
