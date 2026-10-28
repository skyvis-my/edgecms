import { env } from 'cloudflare:workers'
import { Elysia, status } from 'elysia'
import { createAuthForEnv } from '@/auth/auth'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { getSessionForRequest } from '@/auth/session-cache'
import { isMfaVerifiedSession, MFA_REQUIRED_CODE, MFA_REQUIRED_MESSAGE } from '@/auth/mfa'
import { hasSuperAdminRole, isSuperAdminEmail, parseSuperAdminEmails } from '@/auth/super-admin'
import { createDb } from '@/database/db'
import type { Env } from '@/env'
import { getRequestUrl } from '@/shared/utils/request-url'
import type { TenantContext } from './tenant-context'
import { verifyTenantMembership } from './tenant-context'
import { extractTenantSlug } from './tenant-path'
import { tenantsRepository } from './tenants.repository'
import {
  getCachedTenant,
  setCachedTenant,
  getCachedMembership,
  setCachedMembership,
  getCachedFastActor,
} from './tenant-cache'

/** Tenant routes that act as an authenticated user (admin API and MCP). */
const TENANT_MFA_SCOPED_PATH = /^\/api\/tenants\/[^/]+\/api\/(?:admin|mcp)(?:\/|$)/

/**
 * HS-11: when a tenant requires MFA, authenticated users (super-admins
 * included) must hold an MFA-verified session or token on its admin routes.
 */
function assertTenantMfa(request: Request, tenantRequiresMfa: boolean, mfaVerified: boolean) {
  if (!tenantRequiresMfa || mfaVerified) return
  if (!TENANT_MFA_SCOPED_PATH.test(getRequestUrl(request).pathname)) return
  throw status(403, {
    success: false,
    error: { code: MFA_REQUIRED_CODE, message: MFA_REQUIRED_MESSAGE },
  })
}

/**
 * Request surface that keeps serving while a tenant is `suspended`: published
 * public reads (`GET`/`HEAD` under `/api/public`, excluding preview tokens)
 * and the read-only GraphQL endpoint.
 */
export function isPublicReadRequest(method: string, pathname: string, tenantSlug: string): boolean {
  const prefix = `/api/tenants/${tenantSlug}`
  if (!pathname.startsWith(`${prefix}/`)) return false
  // Accept both the canonical alias (`/public/...`) and the rewritten form (`/api/public/...`).
  const rest = pathname.slice(prefix.length).replace(/^\/api(?=\/)/, '')
  const upper = method.toUpperCase()
  if (rest === '/graphql' || rest === '/graphql/') {
    return upper === 'GET' || upper === 'HEAD' || upper === 'POST'
  }
  if (rest.startsWith('/public/')) {
    if (rest.startsWith('/public/preview-token')) return false
    return upper === 'GET' || upper === 'HEAD'
  }
  return false
}

/**
 * HS-04 tenant states:
 * - `active`: normal access.
 * - `suspended`: admin, MCP, AI and sync are locked; public reads continue.
 * - `pending`, `disabled` (and legacy `inactive` or unknown): super-admin only.
 * Super-admins keep access in every state so they can inspect and recover.
 */
export function tenantStateAccess(
  status: string,
  publicRead: boolean
): 'allow' | 'super-admin-only' {
  if (status === 'active') return 'allow'
  if (status === 'suspended' && publicRead) return 'allow'
  return 'super-admin-only'
}

function tenantStateError(tenantSlug: string, tenantStatus: string) {
  const code = tenantStatus === 'suspended' ? 'TENANT_SUSPENDED' : 'TENANT_UNAVAILABLE'
  return status(403, {
    success: false,
    error: {
      code,
      message: `Tenant '${tenantSlug}' is not active (status: ${tenantStatus})`,
    },
  })
}

/**
 * Tenant resolution middleware for ElysiaJS.
 *
 * This middleware extracts the tenant slug from the URL path, validates
 * the tenant exists and is active, and resolves tenant-specific resource
 * bindings (D1/KV/R2).
 *
 * Route pattern: `/api/tenants/:tenantSlug/*`
 *
 * Behavior:
 * - Extracts `tenantSlug` from path params, or the request path when a route schema strips it
 * - Looks up tenant in the global database
 * - Returns 404 if tenant not found
 * - Applies tenant states (HS-04, see `tenantStateAccess`): `suspended` keeps
 *   public reads, `pending`/`disabled` admit super-admins only
 * - Verifies authenticated users are members of the tenant
 * - Uses shared DB/KV/R2 infrastructure (tenant isolation via tenantId)
 * - Attaches `tenant` context to the request for downstream handlers
 *
 * NOTE: In the current phase, resource IDs are just metadata stored in the
 * database. Actual runtime binding resolution (connecting to provisioned
 * D1/KV/R2 resources) will be implemented when the provisioning service
 * (Task 6.3) is ready.
 */
export const tenantMiddleware = new Elysia({ name: 'tenant-middleware' })
  .use(betterAuthPlugin).derive('plugin', async ({ params, request }): Promise<{ tenant?: TenantContext }> => {
  // A route `params` schema strips the group's `tenantSlug` before this derive
  // runs, so fall back to the request path.
  const tenantSlug =
    (params as { tenantSlug?: string } | undefined)?.tenantSlug ??
    extractTenantSlug(getRequestUrl(request).pathname)

  // If no tenantSlug in params, this is not a tenant-scoped route
  // Return empty context (will be ignored by non-tenant routes)
  if (!tenantSlug) {
    return {}
  }

  // Get global database binding
  const db = createDb((env as unknown as Env).DB)

  // Lookup tenant by slug with request cache
  let tenantPromise = getCachedTenant(request, tenantSlug)
  if (!tenantPromise) {
    tenantPromise = tenantsRepository.findBySlug(db, tenantSlug)
    setCachedTenant(request, tenantSlug, tenantPromise)
  }
  const tenant = await tenantPromise

  // Tenant not found
  if (!tenant) {
    throw status(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: `Tenant '${tenantSlug}' not found` },
    })
  }

  const isPublicRead = isPublicReadRequest(
    request.method,
    getRequestUrl(request).pathname,
    tenantSlug
  )
  const superAdminOnly =
    tenantStateAccess(tenant.status, isPublicRead) === 'super-admin-only'

  // Public read routes on active tenants skip user authentication and membership checks completely.
  // This eliminates session/auth overhead and prevents cross-tenant session cookies
  // from incorrectly triggering a 403 Forbidden on public content.
  if (isPublicRead && !superAdminOnly && tenant.status === 'active') {
    return {
      tenant: {
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
          mediaUploadMaxBytes: tenant.mediaUploadMaxBytes,
          mediaUploadMaxDimension: tenant.mediaUploadMaxDimension,
          mediaAllowedMimeTypes: tenant.mediaAllowedMimeTypes,
        },
        resources: {
          mode: 'shared',
        },
      },
    }
  }

  // Verify tenant membership for authenticated users
  // Public routes (unauthenticated) skip this check
  const typedEnv = env as unknown as Env

  // Stateless fast path: api-security already verified this tenant membership
  // from token claims. Reuse it with zero D1 (no createAuth/getSession/verify).
  const cachedFast = getCachedFastActor(request)
  if (
    cachedFast &&
    cachedFast.tenantSlug === tenantSlug &&
    cachedFast.actor.tenantId &&
    cachedFast.actor.tenantId === tenant.id
  ) {
    const fast = cachedFast.actor
    assertTenantMfa(request, tenant.requireMfa === true, fast.mfaVerified === true)
    if (
      fast.isSuperAdminByToken ||
      isSuperAdminEmail(
        fast.actorEmail,
        parseSuperAdminEmails(typedEnv.SUPER_ADMIN_EMAILS),
        fast.emailVerified
      )
    ) {
      return {
        tenant: {
          tenant: {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
            mediaUploadMaxBytes: tenant.mediaUploadMaxBytes,
            mediaUploadMaxDimension: tenant.mediaUploadMaxDimension,
            mediaAllowedMimeTypes: tenant.mediaAllowedMimeTypes,
          },
          resources: {
            mode: 'shared',
          },
        },
      }
    }
    if (superAdminOnly) throw tenantStateError(tenantSlug, tenant.status)
    const fastRole = fast.tenantRole ?? fast.customTenantRole
    if (fastRole) {
      // Seed the per-request membership cache so downstream readers reuse it.
      const resolved = Promise.resolve(fastRole)
      setCachedMembership(request, fast.actorId, tenant.id, resolved)
      setCachedMembership(request, fast.actorId, tenantSlug, resolved)
      return {
        tenant: {
          tenant: {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
            mediaUploadMaxBytes: tenant.mediaUploadMaxBytes,
            mediaUploadMaxDimension: tenant.mediaUploadMaxDimension,
            mediaAllowedMimeTypes: tenant.mediaAllowedMimeTypes,
          },
          resources: {
            mode: 'shared',
          },
        },
      }
    }
  }

  const auth = createAuthForEnv(typedEnv, getRequestUrl(request).origin)
  const session = await getSessionForRequest(auth, request)

  if (session?.user) {
    assertTenantMfa(request, tenant.requireMfa === true, isMfaVerifiedSession(session))
    const sessionUserRole = (session.user as { role?: unknown }).role
    const sessionPayloadRole = (session.session as { role?: unknown } | undefined)?.role
    const isSuperAdminByRole =
      hasSuperAdminRole(sessionUserRole) || hasSuperAdminRole(sessionPayloadRole)
    if (
      isSuperAdminByRole ||
      isSuperAdminEmail(
        session.user.email,
        parseSuperAdminEmails(typedEnv.SUPER_ADMIN_EMAILS),
        session.user.emailVerified === true
      )
    ) {
      return {
        tenant: {
          tenant: {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
            mediaUploadMaxBytes: tenant.mediaUploadMaxBytes,
            mediaUploadMaxDimension: tenant.mediaUploadMaxDimension,
            mediaAllowedMimeTypes: tenant.mediaAllowedMimeTypes,
          },
          resources: {
            mode: 'shared',
          },
        },
      }
    }

    if (superAdminOnly) throw tenantStateError(tenantSlug, tenant.status)

    let rolePromise = getCachedMembership(request, session.user.id, tenant.id)
    if (!rolePromise) {
      rolePromise = getCachedMembership(request, session.user.id, tenantSlug)
    }
    if (!rolePromise) {
      rolePromise = verifyTenantMembership(db, session.user.id, tenant.id)
      setCachedMembership(request, session.user.id, tenant.id, rolePromise)
      setCachedMembership(request, session.user.id, tenantSlug, rolePromise)
    }
    const role = await rolePromise
    if (!role) {
      throw status(403, {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `User is not a member of tenant '${tenantSlug}'`,
        },
      })
    }
  }

  if (superAdminOnly) throw tenantStateError(tenantSlug, tenant.status)

  // Attach tenant context to request
  return {
    tenant: {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        mediaUploadMaxBytes: tenant.mediaUploadMaxBytes,
        mediaUploadMaxDimension: tenant.mediaUploadMaxDimension,
        mediaAllowedMimeTypes: tenant.mediaAllowedMimeTypes,
      },
      resources: {
        mode: 'shared',
      },
    },
  }
})
