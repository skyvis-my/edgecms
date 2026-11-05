import type { PluginAdminAccess } from '@edgecms/plugin-sdk'
import { hasGlobalAdminAccess } from '@/lib/admin-role'

/** What the admin knows about the signed-in user, for display gating only. */
export type AdminViewer = {
  /** Effective global role from `/api/me` (`superadmin`, `admin`, `viewer`, ...). */
  globalRole: string | null
  /** Active tenant workspace, or `null` outside a tenant. */
  tenantSlug: string | null
  /** Tenant role claim (`trl`) from the RBAC access token for `tenantSlug`. */
  tenantRole: string | null
}

const ALL_LEVELS: PluginAdminAccess[] = ['tenant:read', 'tenant:write', 'tenant:manage', 'superadmin']

function normalizeRole(role: string | null): string {
  return (role ?? '').trim().toLowerCase().replace(/[\s_-]/g, '')
}

/**
 * Access levels the viewer holds. Mirrors the API's tenant admin ability
 * (owner/admin manage, editor writes, any member reads). Unknown or custom
 * tenant roles get read only; a missing tenant role gets nothing.
 */
export function resolveViewerAccess(viewer: AdminViewer | null): Set<PluginAdminAccess> {
  if (!viewer) return new Set()
  if (normalizeRole(viewer.globalRole) === 'superadmin') return new Set(ALL_LEVELS)

  if (viewer.tenantSlug) {
    const role = normalizeRole(viewer.tenantRole)
    if (!role) return new Set()
    if (role === 'owner' || role === 'admin') {
      return new Set(['tenant:read', 'tenant:write', 'tenant:manage'])
    }
    if (role === 'editor') return new Set(['tenant:read', 'tenant:write'])
    return new Set(['tenant:read'])
  }

  // Global pages: any signed-in user reads; global admins write and manage.
  if (hasGlobalAdminAccess(viewer.globalRole)) {
    return new Set(['tenant:read', 'tenant:write', 'tenant:manage'])
  }
  return new Set(['tenant:read'])
}

export function canViewContribution(
  access: PluginAdminAccess,
  viewerAccess: ReadonlySet<PluginAdminAccess>
): boolean {
  return viewerAccess.has(access)
}

export type ApiPluginStatus = { name: string; status: 'loaded' | 'blocked' | 'disabled' }

/**
 * EX-01 parity: a plugin the API reports as disabled or blocked contributes
 * nothing. `requiresLoadedApiPlugin` also hides it while the status is unknown.
 */
export function isContributingPluginActive(
  pluginName: string,
  requiresLoadedApiPlugin: boolean,
  apiPlugins: readonly ApiPluginStatus[] | undefined
): boolean {
  const reported = apiPlugins?.find((plugin) => plugin.name === pluginName)
  if (reported) return reported.status === 'loaded'
  return !requiresLoadedApiPlugin
}
