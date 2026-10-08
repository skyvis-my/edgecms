import { env } from 'cloudflare:workers'
import { Elysia } from 'elysia'
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
  .use(betterAuthPlugin)
  .derive(
    { as: 'scoped' },
    async ({ params, set, request }): Promise<{ tenant?: TenantContext }> => {
      // Extract tenant slug from path params
      const tenantSlug = (params as { tenantSlug?: string }).tenantSlug

      // If no tenantSlug in params, this is not a tenant-scoped route
      // Return empty context (will be ignored by non-tenant routes)
      if (!tenantSlug) {
        return {}
      }

      // Get global database binding
      const db = createDb((env as unknown as Env).DB)

      // Lookup tenant by slug
      const tenant = await tenantsRepository.findBySlug(db, tenantSlug)

      // Tenant not found
      if (!tenant) {
        set.status = 404
        throw new Error(`Tenant '${tenantSlug}' not found`)
      }

      // Check tenant status
      if (tenant.status !== 'active') {
        set.status = 403
        throw new Error(`Tenant '${tenantSlug}' is not active (status: ${tenant.status})`)
      }

      // Verify tenant membership for authenticated users
      // Public routes (unauthenticated) skip this check
      const typedEnv = env as unknown as Env
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

        const role = await verifyTenantMembership(db, session.user.id, tenant.id)
        if (!role) {
          set.status = 403
          throw new Error(`User is not a member of tenant '${tenantSlug}'`)
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
    }
  )
