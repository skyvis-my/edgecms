import { Elysia, t } from 'elysia'
import { getAuditDb } from '@/audit/audit-access'
import { resolveAuditRetentionDays } from '@/audit/audit.service'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { createErrorEnvelope, toServiceResponse } from '@/shared/utils/service-response'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { aiSettingsService } from './ai-settings.service'

const TENANT_REQUIRED = createErrorEnvelope('BAD_REQUEST', 'Tenant context required')

/**
 * HS-14 tenant AI switch.
 *
 *   GET /api/tenants/:tenantSlug/api/admin/settings/ai  — state + providers (tenant members)
 *   PUT /api/tenants/:tenantSlug/api/admin/settings/ai  — { aiEnabled } (owners/admins, super-admins)
 */
export const aiSettingsController = new Elysia({ prefix: '/api/admin/settings/ai' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)
  .get('/', { auth: true }, async ({ user, tenantCtx, workerEnv, db, set }) => {
    if (!tenantCtx?.tenant) {
      set.status = 400
      return TENANT_REQUIRED
    }
    set.headers['cache-control'] = 'no-store'
    return toServiceResponse(
      set,
      await aiSettingsService.get(getAuditDb(workerEnv, db), user, tenantCtx.tenant.id, workerEnv)
    )
  })
  .put('/', {
    auth: true,
    body: t.Object({ aiEnabled: t.Boolean() }),
  }, async ({ user, tenantCtx, workerEnv, db, body, set }) => {
    if (!tenantCtx?.tenant) {
      set.status = 400
      return TENANT_REQUIRED
    }
    set.headers['cache-control'] = 'no-store'
    return toServiceResponse(
      set,
      await aiSettingsService.set(
        getAuditDb(workerEnv, db),
        user,
        tenantCtx.tenant.id,
        body.aiEnabled,
        workerEnv,
        { retentionDays: resolveAuditRetentionDays(workerEnv.AUDIT_RETENTION_DAYS) }
      )
    )
  })
