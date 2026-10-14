import { env } from 'cloudflare:workers'
import { Elysia, status } from 'elysia'
import { createAuth } from '@/auth/auth'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { getSessionForRequest } from '@/auth/session-cache'
import { hasSuperAdminRole, isSuperAdminEmail, parseSuperAdminEmails } from '@/auth/super-admin'
import { createDb } from '@/database/db'
import type { Env } from '@/env'
import { getRequestUrl } from '@/shared/utils/request-url'
import type { TenantContext } from './tenant-context'
import { verifyTenantMembership } from './tenant-context'
import { tenantsRepository } from './tenants.repository'
import {
  getCachedTenant,
  setCachedTenant,
  getCachedMembership,
  setCachedMembership,
  getCachedFastActor,
} from './tenant-cache'

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
 * - Extracts `tenantSlug` from path params
 * - Looks up tenant in the global database
 * - Returns 404 if tenant not found
 * - Returns 403 if tenant status is not 'active'
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
  // Extract tenant slug from path params
  const tenantSlug = (params as { tenantSlug?: string } | undefined)?.tenantSlug

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

  // Check tenant status
  if (tenant.status !== 'active') {
    throw status(403, {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: `Tenant '${tenantSlug}' is not active (status: ${tenant.status})`,
      },
    })
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
    if (
      fast.isSuperAdminByToken ||
      isSuperAdminEmail(fast.actorEmail, parseSuperAdminEmails(typedEnv.SUPER_ADMIN_EMAILS))
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

  const auth = createAuth(typedEnv.DB, {
    secret: typedEnv.BETTER_AUTH_SECRET,
    baseURL: getRequestUrl(request).origin,
    entra: {
      clientId: typedEnv.ENTRA_CLIENT_ID,
      clientSecret: typedEnv.ENTRA_CLIENT_SECRET,
      tenantId: typedEnv.ENTRA_TENANT_ID,
    },
    google: {
      clientId: typedEnv.GOOGLE_CLIENT_ID,
      clientSecret: typedEnv.GOOGLE_CLIENT_SECRET,
    },
  })
  const session = await getSessionForRequest(auth, request)

  if (session?.user) {
    const sessionUserRole = (session.user as { role?: unknown }).role
    const sessionPayloadRole = (session.session as { role?: unknown } | undefined)?.role
    const isSuperAdminByRole =
      hasSuperAdminRole(sessionUserRole) || hasSuperAdminRole(sessionPayloadRole)
    if (
      isSuperAdminByRole ||
      isSuperAdminEmail(session.user.email, parseSuperAdminEmails(typedEnv.SUPER_ADMIN_EMAILS))
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
