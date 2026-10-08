import { env } from 'cloudflare:workers'
import { Elysia } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { parseSuperAdminEmails } from '@/auth/super-admin'
import { createDb } from '@/database/db'
import type { Env } from '@/env'
import { hasTenantContext } from '@/tenants/tenant-context'
import { usersService } from './users.service'

export const usersController = new Elysia({ prefix: '/api/admin/users' }).use(betterAuthPlugin).get(
  '/',
  async (ctx) => {
    const db = createDb((env as unknown as Env).DB)
    const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
    const superAdminEmails = parseSuperAdminEmails((env as unknown as Env).SUPER_ADMIN_EMAILS)

    const users = await usersService.findAdminUsers(db, {
      tenantId: tenantCtx?.tenant.id,
      superAdminEmails,
    })

    return {
      success: true as const,
      data: users,
    }
  },
  { auth: true }
)
