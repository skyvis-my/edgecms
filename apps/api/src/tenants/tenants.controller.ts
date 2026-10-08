import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { hasSuperAdminRole, isSuperAdminEmail, parseSuperAdminEmails } from '@/auth/super-admin'
import { createDb } from '@/database/db'
import type { Env } from '@/env'
import { tenantsService } from './tenants.service'

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

/**
 * ElysiaJS controller for tenant CRUD endpoints.
 *
 * All routes are protected with `{ auth: true }` and return responses
 * in the standard API envelope format.
 *
 * These endpoints provide global tenant management for super-admins.
 * Registered under `/api/admin/tenants` in the main app.
 */
/**
 * Super-admin authorization guard macro.
 *
 * Checks either the authenticated user's superadmin role or email configured
 * in SUPER_ADMIN_EMAILS. If neither is present, access is denied unless
 * explicitly enabled by SUPER_ADMIN_DEV_MODE=true.
 */
const superAdminGuard = () => ({
  beforeHandle({
    user,
    set,
  }: {
    user: { email: string; role?: unknown }
    set: { status?: number | string }
  }) {
    const workerEnv = env as unknown as Env
    const superAdminEmails = parseSuperAdminEmails(workerEnv.SUPER_ADMIN_EMAILS)
    const allowDevMode = workerEnv.SUPER_ADMIN_DEV_MODE === 'true'

    if (hasSuperAdminRole(user.role)) {
      return
    }

    // Fail closed unless dev mode is explicitly enabled.
    if (superAdminEmails.length === 0) {
      if (allowDevMode) {
        return
      }
      set.status = 403
      return {
        success: false as const,
        error: {
          code: 'FORBIDDEN',
          message: 'Super-admin access is not configured. Set SUPER_ADMIN_EMAILS.',
        },
      }
    }

    if (!isSuperAdminEmail(user.email, superAdminEmails)) {
      set.status = 403
      return {
        success: false as const,
        error: { code: 'FORBIDDEN', message: 'Super-admin access required' },
      }
    }
  },
})

export const tenantsController = new Elysia({ prefix: '/api/admin/tenants' })
  .use(betterAuthPlugin)

  /**
   * GET / — List all tenants.
   */
  .get(
    '/',
    async () => {
      const db = createDb((env as unknown as Env).DB)
      const result = await tenantsService.findAll(db)
      if (!result.success) {
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    { auth: true, ...superAdminGuard() }
  )

  /**
   * GET /:tenantSlug — Get a tenant by ID or slug with user details.
   */
  .get(
    '/:tenantSlug', async ({ params, set }) => {
      const db = createDb((env as unknown as Env).DB)
      const result = await tenantsService.findByIdOrSlugWithUsers(db, params.tenantSlug)
      if (!result.success) {
        set.status = 404
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    { auth: true, ...superAdminGuard() }
  )

  /**
   * POST / — Create a new tenant.
   */
  .post(
    '/',
    async ({ body, set }) => {
      const db = createDb((env as unknown as Env).DB)
      const result = await tenantsService.create(db, body)
      if (!result.success) {
        set.status = result.error.code === 'CONFLICT' ? 409 : 400
        return { success: false as const, error: result.error }
      }
      set.status = 201
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      ...superAdminGuard(),
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
    }
  )

  /**
   * PUT /:tenantSlug — Update a tenant by ID or slug.
   */
  .put(
    '/:tenantSlug',
    async ({ params, body, set }) => {
      const db = createDb((env as unknown as Env).DB)
      const tenantId = await resolveTenantId(db, params.tenantSlug)
      if (!tenantId) {
        set.status = 404
        return {
          success: false as const,
          error: { code: 'NOT_FOUND', message: `Tenant '${params.tenantSlug}' not found` },
        }
      }

      const result = await tenantsService.update(db, tenantId, body)
      if (!result.success) {
        set.status = result.error.code === 'NOT_FOUND' ? 404 : 400
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      ...superAdminGuard(),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        slug: t.Optional(t.String({ minLength: 1 })),
        status: t.Optional(
          t.Union([t.Literal('active'), t.Literal('inactive'), t.Literal('suspended')])
        ),
        localeCatalog: t.Optional(t.Array(t.String({ minLength: 1 }))),
        targetUrl: t.Optional(t.String({ minLength: 1 })),
        corsOrigin: t.Optional(t.String({ minLength: 1 })),
        mediaUploadMaxBytes: t.Optional(t.Number({ minimum: 1 })),
        mediaUploadMaxDimension: t.Optional(t.Number({ minimum: 1 })),
        mediaAllowedMimeTypes: t.Optional(t.Array(t.String({ minLength: 1 }))),
      }),
    }
  )

  /**
   * DELETE /:tenantSlug — Delete a tenant by ID or slug.
   */
  .delete(
    '/:tenantSlug',
    async ({ params, set }) => {
      const db = createDb((env as unknown as Env).DB)
      const tenantId = await resolveTenantId(db, params.tenantSlug)
      if (!tenantId) {
        set.status = 404
        return {
          success: false as const,
          error: { code: 'NOT_FOUND', message: `Tenant '${params.tenantSlug}' not found` },
        }
      }

      const result = await tenantsService.deleteById(db, tenantId)
      if (!result.success) {
        set.status = 404
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    { auth: true, ...superAdminGuard() }
  )

  /**
   * GET /:tenantSlug/users — Get all users in a tenant.
   */
  .get(
    '/:tenantSlug/users',
    async ({ params, set }) => {
      const db = createDb((env as unknown as Env).DB)
      const tenantId = await resolveTenantId(db, params.tenantSlug)
      if (!tenantId) {
        set.status = 404
        return {
          success: false as const,
          error: { code: 'NOT_FOUND', message: `Tenant '${params.tenantSlug}' not found` },
        }
      }

      const users = await tenantsService.findTenantUsersWithDetails(db, tenantId)
      if (!users.success) {
        return { success: false as const, error: users.error }
      }
      return { success: true as const, data: users.data }
    },
    { auth: true, ...superAdminGuard() }
  )

  /**
   * POST /:tenantSlug/users — Add a user to a tenant.
   */
  .post(
    '/:tenantSlug/users',
    async ({ params, body, set }) => {
      const db = createDb((env as unknown as Env).DB)
      const tenantId = await resolveTenantId(db, params.tenantSlug)
      if (!tenantId) {
        set.status = 404
        return {
          success: false as const,
          error: { code: 'NOT_FOUND', message: `Tenant '${params.tenantSlug}' not found` },
        }
      }

      const result = await tenantsService.addUserToTenant(db, tenantId, body)
      if (!result.success) {
        set.status = result.error.code === 'CONFLICT' ? 409 : 400
        return { success: false as const, error: result.error }
      }
      set.status = 201
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      ...superAdminGuard(),
      body: t.Object({
        userId: t.String({ minLength: 1 }),
        role: t.Union([t.Literal('owner'), t.Literal('admin'), t.Literal('member')]),
      }),
    }
  )

  /**
   * DELETE /:tenantSlug/users/:userId — Remove a user from a tenant.
   */
  .delete(
    '/:tenantSlug/users/:userId',
    async ({ params, set }) => {
      const db = createDb((env as unknown as Env).DB)
      const tenantId = await resolveTenantId(db, params.tenantSlug)
      if (!tenantId) {
        set.status = 404
        return {
          success: false as const,
          error: { code: 'NOT_FOUND', message: `Tenant '${params.tenantSlug}' not found` },
        }
      }

      const result = await tenantsService.removeUserFromTenant(db, tenantId, params.userId)
      if (!result.success) {
        set.status = 404
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    { auth: true, ...superAdminGuard() }
  )

  /**
   * PUT /:tenantSlug/users/:userId — Update a user's role in a tenant.
   */
  .put(
    '/:tenantSlug/users/:userId',
    async ({ params, body, set }) => {
      const db = createDb((env as unknown as Env).DB)
      const tenantId = await resolveTenantId(db, params.tenantSlug)
      if (!tenantId) {
        set.status = 404
        return {
          success: false as const,
          error: { code: 'NOT_FOUND', message: `Tenant '${params.tenantSlug}' not found` },
        }
      }

      const result = await tenantsService.updateUserRole(db, tenantId, params.userId, body.role)
      if (!result.success) {
        set.status = 404
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      ...superAdminGuard(),
      body: t.Object({
        role: t.Union([t.Literal('owner'), t.Literal('admin'), t.Literal('member')]),
      }),
    }
  )
