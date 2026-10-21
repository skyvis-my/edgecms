import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { createErrorEnvelope } from '@/shared/utils/service-response'
import { withTenantBindings } from '@/tenants/with-tenant-bindings'
import { getAuditDb, resolveAuditScopeAccess } from './audit-access'
import { auditService } from './audit.service'

const DEFAULT_EXPORT_LIMIT = 500

/**
 * HS-12 audit ledger endpoints.
 *
 *   GET /api/tenants/:tenantSlug/api/admin/audit/export  — tenant chain (owner/admin)
 *   GET /api/tenants/:tenantSlug/api/admin/audit/verify  — verify tenant chain
 *   GET /api/admin/audit/export | /verify                 — global chain (super-admin)
 *
 * Export pages are cursor-based (`after` = last seq seen) and include the
 * current head so a host can anchor it outside the database.
 */
export const auditController = new Elysia({ prefix: '/api/admin/audit' })
  .use(betterAuthPlugin)
  .use(withTenantBindings)
  .get('/export', {
    auth: true,
    query: t.Object({
      after: t.Optional(t.Numeric({ minimum: 0 })),
      limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000 })),
    }),
  }, async ({ user, tenantCtx, workerEnv, db, query, set }) => {
    const auditDb = getAuditDb(workerEnv, db)
    const access = await resolveAuditScopeAccess({ user, tenantCtx, workerEnv, db: auditDb })
    if (!access.allowed) {
      set.status = access.status
      return createErrorEnvelope(access.code, access.message)
    }
    const page = await auditService.exportPage(
      auditDb,
      access.scope,
      query.after ?? 0,
      query.limit ?? DEFAULT_EXPORT_LIMIT
    )
    set.headers['cache-control'] = 'no-store'
    return { success: true as const, data: page }
  })
  .get('/verify', { auth: true }, async ({ user, tenantCtx, workerEnv, db, set }) => {
    const auditDb = getAuditDb(workerEnv, db)
    const access = await resolveAuditScopeAccess({ user, tenantCtx, workerEnv, db: auditDb })
    if (!access.allowed) {
      set.status = access.status
      return createErrorEnvelope(access.code, access.message)
    }
    const result = await auditService.verify(auditDb, access.scope)
    set.headers['cache-control'] = 'no-store'
    return { success: true as const, data: { scope: access.scope, ...result } }
  })
