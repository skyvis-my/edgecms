import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { createDb } from '@/database/db'
import type { Env } from '@/env'
import { hasTenantContext } from '@/tenants/tenant-context'
import { rbacService } from './rbac.service'

/**
 * ElysiaJS controller for RBAC admin endpoints.
 *
 * All routes are tenant-scoped under /api/tenants/:tenantSlug/api/admin/roles
 * and require tenant admin access.
 */
export const rbacController = new Elysia({ prefix: '/api/admin/roles' })
  .use(betterAuthPlugin)

  /**
   * GET / — List all roles for the current tenant.
   */
  .get(
    '/',
    async ({ set, store }) => {
      const tenantCtx = hasTenantContext(store) ? store.tenant : undefined
      if (!tenantCtx?.tenant) {
        set.status = 400
        return {
          success: false as const,
          error: { code: 'BAD_REQUEST', message: 'Tenant context required' },
        }
      }

      const db = createDb((env as unknown as Env).DB)
      const result = await rbacService.getRolesForTenant(db, tenantCtx.tenant.id)
      if (!result.success) {
        set.status = 404
        return { success: false as const, error: result.error }
      }
      return { success: true as const, data: result.data }
    },
    { auth: true }
  )

  /**
   * GET /:roleId — Get a role by ID with its permissions.
   */
  .get(
    '/:roleId',
    async ({ params, set, store }) => {
      const tenantCtx = hasTenantContext(store) ? store.tenant : undefined
      if (!tenantCtx?.tenant) {
        set.status = 400
        return {
          success: false as const,
          error: { code: 'BAD_REQUEST', message: 'Tenant context required' },
        }
      }

      const db = createDb((env as unknown as Env).DB)
      const role = await rbacService.getRolesForTenant(db, tenantCtx.tenant.id)
      if (!role.success) {
        set.status = 404
        return { success: false as const, error: role.error }
      }

      const foundRole = role.data.find((r) => r.id === params.roleId)
      if (!foundRole) {
        set.status = 404
        return {
          success: false as const,
          error: { code: 'NOT_FOUND', message: `Role '${params.roleId}' not found` },
        }
      }

      const permissions = await rbacService.getEffectivePermissions(
        db,
        tenantCtx.tenant.id,
        foundRole.name
      )
      if (!permissions.success) {
        set.status = 404
        return { success: false as const, error: permissions.error }
      }

      return {
        success: true as const,
        data: {
          ...foundRole,
          permissions: permissions.data,
        },
      }
    },
    { auth: true }
  )

  /**
   * POST / — Create a custom role.
   */
  .post(
    '/',
    async ({ body, set, store }) => {
      const tenantCtx = hasTenantContext(store) ? store.tenant : undefined
      if (!tenantCtx?.tenant) {
        set.status = 400
        return {
          success: false as const,
          error: { code: 'BAD_REQUEST', message: 'Tenant context required' },
        }
      }

      const db = createDb((env as unknown as Env).DB)
      const result = await rbacService.createCustomRole(db, tenantCtx.tenant.id, {
        name: body.name,
        description: body.description,
        permissions: body.permissions,
      })

      if (!result.success) {
        set.status = result.error.code === 'CONFLICT' ? 409 : 400
        return { success: false as const, error: result.error }
      }

      set.status = 201
      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 50 }),
        description: t.Optional(t.String({ maxLength: 255 })),
        permissions: t.Optional(
          t.Array(
            t.Object({
              subject: t.String({ minLength: 1 }),
              action: t.String({ minLength: 1 }),
            })
          )
        ),
      }),
    }
  )

  /**
   * PUT /:roleId — Update a role.
   */
  .put(
    '/:roleId',
    async ({ params, body, set, store }) => {
      const tenantCtx = hasTenantContext(store) ? store.tenant : undefined
      if (!tenantCtx?.tenant) {
        set.status = 400
        return {
          success: false as const,
          error: { code: 'BAD_REQUEST', message: 'Tenant context required' },
        }
      }

      const db = createDb((env as unknown as Env).DB)
      const result = await rbacService.updateRole(
        db,
        tenantCtx.tenant.id,
        params.roleId,
        {
          name: body.name,
          description: body.description,
        }
      )

      if (!result.success) {
        set.status = result.error.code === 'NOT_FOUND' ? 404 : 400
        return { success: false as const, error: result.error }
      }

      return { success: true as const, data: result.data }
    },
    {
      auth: true,
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
        description: t.Optional(t.String({ maxLength: 255 })),
      }),
    }
  )

  /**
   * DELETE /:roleId — Delete a custom role.
   */
  .delete(
    '/:roleId',
    async ({ params, set, store }) => {
      const tenantCtx = hasTenantContext(store) ? store.tenant : undefined
      if (!tenantCtx?.tenant) {
        set.status = 400
        return {
          success: false as const,
          error: { code: 'BAD_REQUEST', message: 'Tenant context required' },
        }
      }

      const db = createDb((env as unknown as Env).DB)
      const result = await rbacService.deleteCustomRole(db, tenantCtx.tenant.id, params.roleId)

      if (!result.success) {
        set.status = result.error.code === 'NOT_FOUND' ? 404 : 403
        return { success: false as const, error: result.error }
      }

      return { success: true as const, data: result.data }
    },
    { auth: true }
  )

  /**
   * GET /:roleId/permissions — List permissions for a role.
   */
  .get(
    '/:roleId/permissions',
    async ({ params, set, store }) => {
      const tenantCtx = hasTenantContext(store) ? store.tenant : undefined
      if (!tenantCtx?.tenant) {
        set.status = 400
        return {
          success: false as const,
          error: { code: 'BAD_REQUEST', message: 'Tenant context required' },
        }
      }

      const db = createDb((env as unknown as Env).DB)
      const role = await rbacService.getRolesForTenant(db, tenantCtx.tenant.id)
      if (!role.success) {
        set.status = 404
        return { success: false as const, error: role.error }
      }

      const foundRole = role.data.find((r) => r.id === params.roleId)
      if (!foundRole) {
        set.status = 404
        return {
          success: false as const,
          error: { code: 'NOT_FOUND', message: `Role '${params.roleId}' not found` },
        }
      }

      const permissions = await rbacService.getEffectivePermissions(
        db,
        tenantCtx.tenant.id,
        foundRole.name
      )
      if (!permissions.success) {
        set.status = 404
        return { success: false as const, error: permissions.error }
      }

      return { success: true as const, data: permissions.data }
    },
    { auth: true }
  )
