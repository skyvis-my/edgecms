import { Elysia } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { systemService } from './system.service'

export const systemController = new Elysia({ prefix: '/api/admin/system' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)
  .get('/stats', ({ db, tenantCtx }) => systemService.getStats(db, tenantCtx?.tenant.id))
  .get('/dashboard', { auth: true }, ({ db, tenantCtx }) =>
    systemService.getDashboardSummary(db, tenantCtx?.tenant.id)
  )
  .post('/sweep-schedules', { auth: true }, async ({ db, workerEnv, set }) => {
    if (!workerEnv || !(workerEnv as Env).PUBLISH_SCHEDULER) {
      set.status = 500
      return { success: false as const, error: 'Scheduler binding unavailable' }
    }
    const result = await systemService.sweepSchedules(db, workerEnv as unknown as Env)
    return { success: true as const, data: result }
  })
