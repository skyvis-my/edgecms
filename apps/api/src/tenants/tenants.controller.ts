import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { isSuperAdminUser, parseSuperAdminEmails } from '@/auth/super-admin'
import type { createDb } from '@/database/db'
import type { Env } from '@/env'
import { bumpAuthRevision, bumpPermissionRevision } from '@/auth/auth-revision'
import { withTenantBindings } from './with-tenant-bindings'
import { tenantsService } from './tenants.service'
import { toServiceResponse } from '@/shared/utils/service-response'
import { resolveHostPolicies, type ResolvedHostPolicies } from '@/host/host-policies'
import { createTenantEventPublisher, type TenantEventPublisher } from '@/host/tenant-events'

async function resolveTenantId(
  db: ReturnType<typeof createDb>,
  tenantSlug: string
): Promise<string | null> {
  const tenant = await tenantsService.findByIdOrSlug(db, tenantSlug)
  if (!tenant.success) {
    return null
  }
  return tenant.data.id
}

async function resolveTenantOr404(
  db: ReturnType<typeof createDb>,
  tenantSlug: string,
  set: { status?: number | string | unknown }
) {
  const tenantId = await resolveTenantId(db, tenantSlug)
  if (!tenantId) {
    set.status = 404
    return {
      error: {
        success: false as const,
        error: { code: 'NOT_FOUND' as const, message: `Tenant '${tenantSlug}' not found` },
      },
    }
  }
  return { tenantId }
}

type SuperAdminDenial = {
  status: 401 | 403
  body: {
    success: false
    error: { code: 'UNAUTHORIZED' | 'FORBIDDEN'; message: string }
  }
}

/**
 * Super-admin check shared by the guard and the HS-02 tenant creation actor.
 *
 * Checks either the authenticated user's superadmin role or email configured
 * in SUPER_ADMIN_EMAILS. If neither is present, access is denied unless
 * explicitly enabled by SUPER_ADMIN_DEV_MODE=true.
 */
function evaluateSuperAdmin(
  user: { email: string; role?: unknown } | undefined
): SuperAdminDenial | null {
  if (!user) {
    return {
      status: 401,
      body: { success: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
    }
  }

  const workerEnv = env as unknown as Env
  if (isSuperAdminUser(user, workerEnv)) {
    return null
  }

  // Fail closed unless dev mode is explicitly enabled (handled by isSuperAdminUser).
  if (parseSuperAdminEmails(workerEnv.SUPER_ADMIN_EMAILS).length === 0) {
    return {
      status: 403,
      body: {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Super-admin access is not configured. Set SUPER_ADMIN_EMAILS.',
        },
      },
    }
  }

  return {
    status: 403,
    body: { success: false, error: { code: 'FORBIDDEN', message: 'Super-admin access required' } },
  }
}

/** Super-admin authorization guard configuration. */
export const superAdminRoute = {
  auth: true as const,
  beforeHandle({
    user,
    set,
  }: {
    user?: { email: string; role?: unknown }
    set: { status?: number | string | unknown }
  }) {
    const denial = evaluateSuperAdmin(user)
    if (denial) {
      set.status = denial.status
      return denial.body
    }
  },
}

export type TenantsControllerOptions = {
  /** Host policies for this app instance (defaults keep today's behavior). */
  host?: ResolvedHostPolicies
  /** Lifecycle event publisher for this app instance (HS-08). */
  events?: TenantEventPublisher
}

/**
 * ElysiaJS controller for tenant CRUD endpoints.
 *
 * All routes are protected with super-admin guards and return responses
 * in the standard API envelope format, except `POST /`, which asks the
 * host's `canCreateTenant` policy (HS-02; default: super-admins only).
 *
 * These endpoints provide global tenant management for super-admins.
 * Registered under `/api/admin/tenants` in the main app.
 */
export function createTenantsController(options: TenantsControllerOptions = {}) {
  const host = options.host ?? resolveHostPolicies()
  const events = options.events ?? createTenantEventPublisher(host)

  return new Elysia({ prefix: '/api/admin/tenants' })
    .use(betterAuthPlugin)
    .use(withTenantBindings)

    /**
     * GET / — List all tenants.
     */
    .get('/', superAdminRoute, async ({ db, set }) => {
      const result = await tenantsService.findAll(db)
      return toServiceResponse(set, result)
    })

    /**
     * GET /:tenantSlug — Get a tenant by ID or slug with user details.
     */
    .get('/:tenantSlug', {
      ...superAdminRoute,
      params: t.Object({
        tenantSlug: t.String({ minLength: 1 }),
      }),
    }, async ({ db, params, set }) => {
      const result = await tenantsService.findByIdOrSlugWithUsers(db, params.tenantSlug)
      return toServiceResponse(set, result)
    })

    /**
     * POST / — Create a new tenant.
     */
    .post('/', {
      auth: true,
      body: t.Object({
        name: t.String({ minLength: 1 }),
        slug: t.String({ minLength: 1 }),
        localeCatalog: t.Optional(t.Array(t.String({ minLength: 1 }))),
        targetUrl: t.Optional(t.String({ minLength: 1 })),
        corsOrigin: t.Optional(t.String({ minLength: 1 })),
        mediaUploadMaxBytes: t.Optional(t.Number({ minimum: 1 })),
        mediaUploadMaxDimension: t.Optional(t.Number({ minimum: 1 })),
        mediaAllowedMimeTypes: t.Optional(t.Array(t.String({ minLength: 1 }))),
      }),
    }, async ({ db, body, set, user }) => {
      const superAdminDenial = evaluateSuperAdmin(user)
      if (superAdminDenial?.status === 401) {
        set.status = 401
        return superAdminDenial.body
      }
      const actor = {
        userId: user.id,
        email: user.email,
        isSuperAdmin: superAdminDenial === null,
        source: 'admin-api' as const,
      }
      const result = await tenantsService.createForActor(db, body, actor, host, { events })
      return toServiceResponse(set, result, { successStatus: 201 })
    })

    /**
     * PUT /:tenantSlug — Update a tenant by ID or slug.
     */
    .put('/:tenantSlug', {
      ...superAdminRoute,
      params: t.Object({
        tenantSlug: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        slug: t.Optional(t.String({ minLength: 1 })),
        status: t.Optional(
          t.Union([
            t.Literal('pending'),
            t.Literal('active'),
            t.Literal('suspended'),
            t.Literal('disabled'),
            t.Literal('inactive'),
          ])
        ),
        localeCatalog: t.Optional(t.Array(t.String({ minLength: 1 }))),
        targetUrl: t.Optional(t.String({ minLength: 1 })),
        corsOrigin: t.Optional(t.String({ minLength: 1 })),
        mediaUploadMaxBytes: t.Optional(t.Number({ minimum: 1 })),
        mediaUploadMaxDimension: t.Optional(t.Number({ minimum: 1 })),
        mediaAllowedMimeTypes: t.Optional(t.Array(t.String({ minLength: 1 }))),
        requireMfa: t.Optional(t.Boolean()),
      }),
    }, async ({ db, params, body, set, user }) => {
      const resolved = await resolveTenantOr404(db, params.tenantSlug, set)
      if ('error' in resolved) return resolved.error
      const result = await tenantsService.update(db, resolved.tenantId, body, {
        events,
        actorId: user.id,
      })
      if (result.success && body.requireMfa !== undefined) {
        // Access tokens minted under the old MFA setting must be re-minted.
        await bumpPermissionRevision((env as unknown as Env).CACHE, resolved.tenantId)
      }
      return toServiceResponse(set, result)
    })

    /**
     * DELETE /:tenantSlug — Delete a tenant by ID or slug.
     */
    .delete('/:tenantSlug', {
      ...superAdminRoute,
      params: t.Object({
        tenantSlug: t.String({ minLength: 1 }),
      }),
    }, async ({ db, params, set, user }) => {
      const resolved = await resolveTenantOr404(db, params.tenantSlug, set)
      if ('error' in resolved) return resolved.error
      const result = await tenantsService.deleteById(db, resolved.tenantId, undefined, {
        events,
        actorId: user.id,
      })
      return toServiceResponse(set, result)
    })

    /**
     * GET /:tenantSlug/users — Get all users in a tenant.
     */
    .get('/:tenantSlug/users', {
      ...superAdminRoute,
      params: t.Object({
        tenantSlug: t.String({ minLength: 1 }),
      }),
    }, async ({ db, params, set }) => {
      const resolved = await resolveTenantOr404(db, params.tenantSlug, set)
      if ('error' in resolved) return resolved.error
      const users = await tenantsService.findTenantUsersWithDetails(db, resolved.tenantId)
      return toServiceResponse(set, users)
    })

    /**
     * POST /:tenantSlug/users — Add a user to a tenant.
     */
    .post('/:tenantSlug/users', {
      ...superAdminRoute,
      params: t.Object({
        tenantSlug: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        userId: t.String({ minLength: 1 }),
        role: t.Union([t.Literal('owner'), t.Literal('admin'), t.Literal('member')]),
      }),
    }, async ({ db, params, body, set }) => {
      const resolved = await resolveTenantOr404(db, params.tenantSlug, set)
      if ('error' in resolved) return resolved.error
      const result = await tenantsService.addUserToTenant(db, resolved.tenantId, body)
      if (result.success) {
        await bumpAuthRevision((env as unknown as Env).CACHE, body.userId, resolved.tenantId)
      }
      return toServiceResponse(set, result, { successStatus: 201 })
    })

    /**
     * DELETE /:tenantSlug/users/:userId — Remove a user from a tenant.
     */
    .delete('/:tenantSlug/users/:userId', {
      ...superAdminRoute,
      params: t.Object({
        tenantSlug: t.String({ minLength: 1 }),
        userId: t.String({ minLength: 1 }),
      }),
    }, async ({ db, params, set }) => {
      const resolved = await resolveTenantOr404(db, params.tenantSlug, set)
      if ('error' in resolved) return resolved.error
      const result = await tenantsService.removeUserFromTenant(db, resolved.tenantId, params.userId)
      if (result.success) {
        await bumpAuthRevision((env as unknown as Env).CACHE, params.userId, resolved.tenantId)
      }
      return toServiceResponse(set, result)
    })

    /**
     * PUT /:tenantSlug/users/:userId — Update a user's role in a tenant.
     */
    .put('/:tenantSlug/users/:userId', {
      ...superAdminRoute,
      params: t.Object({
        tenantSlug: t.String({ minLength: 1 }),
        userId: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        role: t.Union([t.Literal('owner'), t.Literal('admin'), t.Literal('member')]),
      }),
    }, async ({ db, params, body, set }) => {
      const resolved = await resolveTenantOr404(db, params.tenantSlug, set)
      if ('error' in resolved) return resolved.error
      const result = await tenantsService.updateUserRole(db, resolved.tenantId, params.userId, body.role)
      if (result.success) {
        await bumpAuthRevision((env as unknown as Env).CACHE, params.userId, resolved.tenantId)
      }
      return toServiceResponse(set, result)
    })
}

/** Controller with default host policies (backward compatible). */
export const tenantsController = createTenantsController()
