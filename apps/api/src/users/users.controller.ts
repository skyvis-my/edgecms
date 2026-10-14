import { Elysia } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { parseSuperAdminEmails } from '@/auth/super-admin'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { usersService } from './users.service'

export const usersController = new Elysia({ prefix: '/api/admin/users' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)
  .get('/', { auth: true }, async ({ db, tenantCtx, workerEnv }) => {
    const superAdminEmails = parseSuperAdminEmails(workerEnv.SUPER_ADMIN_EMAILS)

    const users = await usersService.findAdminUsers(db, {
      tenantId: tenantCtx?.tenant.id,
      superAdminEmails,
    })

    return {
      success: true as const,
      data: users,
    }
  })
