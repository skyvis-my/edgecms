import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { bumpPermissionRevision } from '@/auth/auth-revision'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import type { Database } from '@/database/db'
import { toServiceResponse } from '@/shared/utils/service-response'
import type { TenantContext } from '@/tenants/tenant-context'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { rbacService } from './rbac.service'

function requireTenantContext(
  set: { status?: number | string | unknown },
  tenantCtx: TenantContext | undefined
): tenantCtx is TenantContext {
  if (!tenantCtx?.tenant) {
    set.status = 400
    return false
  }
  return true
}

const TENANT_REQUIRED_ERROR = {
  success: false as const,
  error: { code: 'BAD_REQUEST', message: 'Tenant context required' },
}

async function findRoleWithPermissions(
  db: Database,
  tenantId: string,
  roleId: string,
  set: { status?: number | string | unknown }
) {
  const rolesResult = await rbacService.getRolesForTenant(db, tenantId)
  if (!rolesResult.success) {
    set.status = 404
    return { error: { success: false as const, error: rolesResult.error } }
  }

  const foundRole = rolesResult.data.find((r) => r.id === roleId)
  if (!foundRole) {
    set.status = 404
    return {
      error: {
        success: false as const,
        error: { code: 'NOT_FOUND', message: `Role '${roleId}' not found` },
      },
    }
  }

  const permissionsResult = await rbacService.getEffectivePermissions(
    db,
    tenantId,
    foundRole.name
  )
  if (!permissionsResult.success) {
    set.status = 404
    return { error: { success: false as const, error: permissionsResult.error } }
  }

  return { role: foundRole, permissions: permissionsResult.data }
}

/**
 * ElysiaJS controller for RBAC admin endpoints.
 *
 * All routes are tenant-scoped under /api/tenants/:tenantSlug/api/admin/roles
 * and require tenant admin access.
 */
export const rbacController = new Elysia({ prefix: '/api/admin/roles' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)

  /**
   * GET / — List all roles for the current tenant.
   */
  .get('/', { auth: true }, async ({ db, set, tenantCtx }) => {
    if (!requireTenantContext(set, tenantCtx)) return TENANT_REQUIRED_ERROR
    return toServiceResponse(set, await rbacService.getRolesForTenant(db, tenantCtx.tenant.id))
  })

  /**
   * GET /:roleId — Get a role by ID with its permissions.
   */
  .get('/:roleId', { auth: true }, async ({ db, params, set, tenantCtx }) => {
    if (!requireTenantContext(set, tenantCtx)) return TENANT_REQUIRED_ERROR
    const result = await findRoleWithPermissions(db, tenantCtx.tenant.id, params.roleId, set)
    if ('error' in result) return result.error
    return {
      success: true as const,
      data: { ...result.role, permissions: result.permissions },
    }
  })

  /**
   * POST / — Create a custom role.
   */
  .post('/', {
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
  }, async ({ body, db, set, tenantCtx }) => {
    if (!requireTenantContext(set, tenantCtx)) return TENANT_REQUIRED_ERROR
    const result = await rbacService.createCustomRole(db, tenantCtx.tenant.id, body)
    if (result.success) {
      await bumpPermissionRevision((env as unknown as Env).CACHE, tenantCtx.tenant.id)
    }
    return toServiceResponse(set, result, { successStatus: 201 })
  })

  /**
   * PUT /:roleId — Update a role.
   */
  .put('/:roleId', {
    auth: true,
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
      description: t.Optional(t.String({ maxLength: 255 })),
    }),
  }, async ({ body, db, params, set, tenantCtx }) => {
    if (!requireTenantContext(set, tenantCtx)) return TENANT_REQUIRED_ERROR
    const result = await rbacService.updateRole(db, tenantCtx.tenant.id, params.roleId, body)
    if (result.success) {
      await bumpPermissionRevision((env as unknown as Env).CACHE, tenantCtx.tenant.id)
    }
    return toServiceResponse(set, result)
  })

  /**
   * DELETE /:roleId — Delete a custom role.
   */
  .delete('/:roleId', { auth: true }, async ({ db, params, set, tenantCtx }) => {
    if (!requireTenantContext(set, tenantCtx)) return TENANT_REQUIRED_ERROR
    const result = await rbacService.deleteCustomRole(db, tenantCtx.tenant.id, params.roleId)
    if (result.success) {
      await bumpPermissionRevision((env as unknown as Env).CACHE, tenantCtx.tenant.id)
    }
    return toServiceResponse(set, result, { defaultErrorStatus: 403 })
  })

  /**
   * GET /:roleId/permissions — List permissions for a role.
   */
  .get('/:roleId/permissions', { auth: true }, async ({ db, params, set, tenantCtx }) => {
    if (!requireTenantContext(set, tenantCtx)) return TENANT_REQUIRED_ERROR
    const result = await findRoleWithPermissions(db, tenantCtx.tenant.id, params.roleId, set)
    if ('error' in result) return result.error
    return { success: true as const, data: result.permissions }
  })
