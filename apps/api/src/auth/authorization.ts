import { AbilityBuilder, createMongoAbility } from '@casl/ability'
import type { ActorRole, TenantActorRole } from './rbac'
import { GLOBAL_MCP_PATH } from '@/mcp/mcp-auth'

export type AuthorizationAction = 'manage' | 'mutate' | 'read'
export type AuthorizationSubject =
  | 'all'
  | 'GlobalAdminApi'
  | 'TenantAdminApi'
  | 'GlobalAdminUsers'
  | 'TenantAdminUsers'
  | 'TenantAdminAudit'
  | 'GlobalAdminRoles'
  | 'TenantAdminRoles'
  | 'GlobalAdminWebhooks'
  | 'TenantAdminWebhooks'
  | 'GlobalAdminAssetsHardDelete'
  | 'TenantAdminAssetsHardDelete'
  | 'TenantContent'
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
  if (pathname.includes('/graphql')) return false
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

function isTenantAdminAuditPath(pathname: string, method: string): boolean {
  if (method !== 'GET') return false
  return /^\/api\/tenants\/[^/]+\/api\/admin\/audit(?:\/|$)/.test(pathname)
}

function isRolesMutationPath(pathname: string, method: string): boolean {
  if (SAFE_METHODS.has(method)) return false
  return (
    pathname.startsWith('/api/admin/roles') ||
    /^\/api\/tenants\/[^/]+\/api\/admin\/roles(?:\/|$)/.test(pathname) ||
    isMemberRoleMutationPath(pathname)
  )
}

/** PL-03: assigning a member's role is a role change (owner/admin or an explicit grant). */
function isMemberRoleMutationPath(pathname: string): boolean {
  return /^(?:\/api\/tenants\/[^/]+)?\/api\/admin\/users\/[^/]+\/role\/?$/.test(pathname)
}

/**
 * PL-03: tenant content routes (entry CRUD, versions, commands and OP-06
 * collection export/import). The guard checks the coarse `TenantContent`
 * ability; handlers and the command engine then check per-collection grants
 * (see `content-access.ts`).
 */
const TENANT_CONTENT_PATH =
  /^\/api\/tenants\/[^/]+\/api\/admin\/(?:entries|commands|collections\/[^/]+\/(?:export|import))(?:\/|$)/

function isTenantContentPath(pathname: string): boolean {
  return TENANT_CONTENT_PATH.test(pathname)
}

/** Webhook configuration and delivery reads (not the static `/signing` doc). */
function isWebhooksReadPath(pathname: string, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false
  const match =
    /^\/api\/admin\/webhooks(\/.*)?$/.exec(pathname) ??
    /^\/api\/tenants\/[^/]+\/api\/admin\/webhooks(\/.*)?$/.exec(pathname)
  if (!match) return false
  const rest = match[1] ?? ''
  return rest !== '/signing' && rest !== '/signing/'
}

function isWebhooksMutationPath(pathname: string, method: string): boolean {
  if (SAFE_METHODS.has(method)) return false
  return (
    pathname.startsWith('/api/admin/webhooks') ||
    /^\/api\/tenants\/[^/]+\/api\/admin\/webhooks(?:\/|$)/.test(pathname)
  )
}

function isAssetHardDeletePath(pathname: string, method: string): boolean {
  if (method === 'DELETE') {
    return (
      /\/api\/admin\/assets\/[^/]+\/permanent(?:\/|$)/.test(pathname) ||
      /^\/api\/tenants\/[^/]+\/api\/admin\/assets\/[^/]+\/permanent(?:\/|$)/.test(pathname)
    )
  }
  if (method === 'POST') {
    return (
      pathname === '/api/admin/assets/gc' ||
      pathname === '/api/admin/assets/gc/' ||
      /^\/api\/tenants\/[^/]+\/api\/admin\/assets\/gc(?:\/|$)/.test(pathname)
    )
  }
  return false
}

function resolveRequirement(
  pathname: string,
  method: string
): AuthorizationRequirement | undefined {
  if (isAssetHardDeletePath(pathname, method)) {
    const isTenant = isTenantScopedPath(pathname)
    return {
      action: 'manage',
      subject: isTenant ? 'TenantAdminAssetsHardDelete' : 'GlobalAdminAssetsHardDelete',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: isTenant ? 'Tenant owner or admin access required' : 'Admin access required',
    }
  }

  if (isRolesMutationPath(pathname, method)) {
    const isTenant = isTenantScopedPath(pathname)
    return {
      action: 'manage',
      subject: isTenant ? 'TenantAdminRoles' : 'GlobalAdminRoles',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: isTenant ? 'Tenant owner or admin access required' : 'Admin access required',
    }
  }

  if (isWebhooksMutationPath(pathname, method)) {
    const isTenant = isTenantScopedPath(pathname)
    return {
      action: 'manage',
      subject: isTenant ? 'TenantAdminWebhooks' : 'GlobalAdminWebhooks',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: isTenant ? 'Tenant owner or admin access required' : 'Admin access required',
    }
  }

  if (isWebhooksReadPath(pathname, method)) {
    const isTenant = isTenantScopedPath(pathname)
    return {
      action: 'read',
      subject: isTenant ? 'TenantAdminWebhooks' : 'GlobalAdminWebhooks',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: isTenant ? 'Tenant owner or admin access required' : 'Admin access required',
    }
  }

  if (isTenantContentPath(pathname) && method !== 'OPTIONS') {
    return {
      action: SAFE_METHODS.has(method) ? 'read' : 'mutate',
      subject: 'TenantContent',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: 'Insufficient role',
    }
  }

  if (isTenantAdminAuditPath(pathname, method)) {
    return {
      action: 'read',
      subject: 'TenantAdminAudit',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: 'Tenant owner or admin access required',
    }
  }

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

  // P2 / AI-06: the global MCP endpoint reads and changes the global scope, so
  // users need the same global role as the admin API (deployment keys skip
  // this check in the security guard).
  if (method === 'POST' && GLOBAL_MCP_PATH.test(pathname)) {
    return {
      action: 'mutate',
      subject: 'GlobalAdminApi',
      unauthenticatedMessage: 'Authentication required',
      forbiddenMessage: 'Insufficient role',
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
    can('manage', 'GlobalAdminRoles')
    can('manage', 'GlobalAdminWebhooks')
    can('manage', 'GlobalAdminAssetsHardDelete')
  }

  if (principal.actorRole === 'editor') {
    can('mutate', 'GlobalAdminApi')
    can('read', 'GlobalAdminApi')
  }

  if (
    principal.tenantRole === 'owner' ||
    principal.tenantRole === 'admin'
  ) {
    can('mutate', 'TenantAdminApi')
    can('read', 'TenantAdminApi')
    can('mutate', 'TenantContent')
    can('read', 'TenantContent')
    can('read', 'TenantAdminUsers')
    can('read', 'TenantAdminAudit')
    can('manage', 'TenantAdminRoles')
    can('manage', 'TenantAdminWebhooks')
    can('manage', 'TenantAdminAssetsHardDelete')
  }

  if (principal.tenantRole === 'editor') {
    can('mutate', 'TenantAdminApi')
    can('read', 'TenantAdminApi')
    can('mutate', 'TenantContent')
    can('read', 'TenantContent')
  }

  if (principal.tenantRole === 'member') {
    can('read', 'TenantAdminApi')
    can('read', 'TenantContent')
  }

  // Apply custom permissions from database
  if (customPermissions && customPermissions.length > 0) {
    for (const perm of customPermissions) {
      const action = mapDbActionToAuthorizationAction(perm.action)
      if (!action) continue
      for (const subject of mapDbSubjectToAuthorizationSubjects(perm.subject)) {
        can(action, subject)
      }
    }
  }

  return build()
}

/**
 * Map a stored permission subject to the guard subjects it grants. Entry
 * grants (and `TenantAdminApi`, `*:*`) also open the content routes; the
 * per-collection check happens in handlers and the command engine.
 */
function mapDbSubjectToAuthorizationSubjects(dbSubject: string): AuthorizationSubject[] {
  const subject = mapDbSubjectToAuthorizationSubject(dbSubject)
  if (!subject) return []
  if (subject === 'TenantAdminApi' || subject === 'entry' || dbSubject === '*:*') {
    return [subject, 'TenantContent']
  }
  return [subject]
}

/** Map database permission subject to authorization subject. */
function mapDbSubjectToAuthorizationSubject(dbSubject: string): AuthorizationSubject | null {
  // Direct mapping for API subjects
  if (dbSubject === 'TenantAdminApi') return 'TenantAdminApi'
  if (dbSubject === 'GlobalAdminApi') return 'GlobalAdminApi'
  if (dbSubject === 'TenantAdminRoles') return 'TenantAdminRoles'
  if (dbSubject === 'GlobalAdminRoles') return 'GlobalAdminRoles'
  if (dbSubject === 'TenantAdminWebhooks' || dbSubject === 'webhooks:*' || dbSubject.startsWith('webhooks:')) {
    return 'TenantAdminWebhooks'
  }
  if (dbSubject === 'GlobalAdminWebhooks') return 'GlobalAdminWebhooks'
  if (dbSubject === 'TenantAdminAssetsHardDelete') return 'TenantAdminAssetsHardDelete'
  if (dbSubject === 'GlobalAdminAssetsHardDelete') return 'GlobalAdminAssetsHardDelete'
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
