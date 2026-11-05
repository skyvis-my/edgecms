import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { isSuperAdminUser } from '@/audit/audit-access'
import { resolveAuditRetentionDays } from '@/audit/audit.service'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { createDb } from '@/database/db'
import type { Env } from '@/env'
import type { TenantEventPublisher } from '@/host/tenant-events'
import { createErrorEnvelope, toServiceResponse } from '@/shared/utils/service-response'
import { verifyTenantMembership } from '@/tenants/tenant-context'
import { offboardingRepository } from './offboarding.repository'
import { offboardingService, type OffboardingDeps } from './offboarding.service'
import { tenantExportLines, toNdjsonStream } from './tenant-export'

type AuthUser = { id: string; email?: string | null; emailVerified?: boolean | null; role?: unknown }
type MutableSet = { status?: number | string | unknown }

const ERROR_STATUS = {
  DEDICATED_RESOURCES_UNSUPPORTED: 409,
  CONFIRMATION_MISMATCH: 422,
  EXPORT_RECEIPT_NOT_FOUND: 422,
  EXPORT_RECEIPT_STALE: 422,
  JOB_BUSY: 409,
  DELETION_FAILED: 500,
}

function workerEnv(): Env {
  return env as unknown as Env
}

function forbidUnlessSuperAdmin(user: AuthUser | undefined, set: MutableSet) {
  if (isSuperAdminUser(user, workerEnv())) return null
  set.status = 403
  return createErrorEnvelope('FORBIDDEN', 'Super-admin access required')
}

export type OffboardingControllerOptions = {
  /** Lifecycle event publisher for this app instance (HS-08). */
  events?: Pick<TenantEventPublisher, 'publish'>
}

/**
 * HS-09 tenant offboarding (shared-mode tenants).
 *
 *   GET  /api/admin/tenants/:tenantSlug/export            — NDJSON archive (super-admin or tenant owner)
 *   POST /api/admin/tenants/:tenantSlug/deletion-requests — step 1: open a job, suspend the tenant
 *   GET  /api/admin/tenant-deletions/:jobId               — job status and per-table counts
 *   POST /api/admin/tenant-deletions/:jobId/confirm       — step 2: { tenantSlug, exportId } then delete
 *   POST /api/admin/tenant-deletions/:jobId/resume        — continue a confirmed job
 *   POST /api/admin/tenant-deletions/:jobId/cancel        — cancel before confirmation
 *
 * Deletion routes are super-admin only and always read the control-plane D1.
 */
export function createOffboardingController(options: OffboardingControllerOptions = {}) {
  const deps = (): OffboardingDeps => {
    const typedEnv = workerEnv()
    return {
      events: options.events,
      kv: typedEnv.CACHE,
      retentionDays: resolveAuditRetentionDays(typedEnv.AUDIT_RETENTION_DAYS),
    }
  }
  const db = () => createDb(workerEnv().DB)

  return new Elysia()
    .use(betterAuthPlugin)
    .get(
      '/api/admin/tenants/:tenantSlug/export',
      { auth: true, params: t.Object({ tenantSlug: t.String({ minLength: 1 }) }) },
      async ({ user, params, set }) => {
        const database = db()
        const superAdmin = isSuperAdminUser(user, workerEnv())
        const tenant = await offboardingRepository.findTenant(database, params.tenantSlug)
        if (!tenant) {
          // Non-super-admins get the same 403 for unknown and foreign tenants.
          set.status = superAdmin ? 404 : 403
          return superAdmin
            ? createErrorEnvelope('NOT_FOUND', `Tenant '${params.tenantSlug}' not found`)
            : createErrorEnvelope('FORBIDDEN', 'Tenant owner or super-admin access required')
        }
        if (!superAdmin) {
          const role = await verifyTenantMembership(database, user.id, tenant.id)
          if (role !== 'owner') {
            set.status = 403
            return createErrorEnvelope('FORBIDDEN', 'Tenant owner or super-admin access required')
          }
        }
        const exportId = crypto.randomUUID()
        const lines = tenantExportLines(database, tenant, {
          exportId,
          actorId: user.id,
          requestedBy: superAdmin ? 'super_admin' : 'owner',
          retentionDays: deps().retentionDays,
        })
        return new Response(toNdjsonStream(lines), {
          headers: {
            'content-type': 'application/x-ndjson; charset=utf-8',
            'cache-control': 'no-store',
            'content-disposition': `attachment; filename="tenant-${tenant.slug}-${exportId}.ndjson"`,
            'x-edgecms-export-id': exportId,
          },
        })
      }
    )
    .post(
      '/api/admin/tenants/:tenantSlug/deletion-requests',
      { auth: true, params: t.Object({ tenantSlug: t.String({ minLength: 1 }) }) },
      async ({ user, params, set }) => {
        const denied = forbidUnlessSuperAdmin(user, set)
        if (denied) return denied
        const result = await offboardingService.requestDeletion(db(), params.tenantSlug, user.id, deps())
        set.headers['cache-control'] = 'no-store'
        return toServiceResponse(set, result, { errorStatusMap: ERROR_STATUS, successStatus: 202 })
      }
    )
    .get(
      '/api/admin/tenant-deletions/:jobId',
      { auth: true, params: t.Object({ jobId: t.String({ minLength: 1 }) }) },
      async ({ user, params, set }) => {
        const denied = forbidUnlessSuperAdmin(user, set)
        if (denied) return denied
        set.headers['cache-control'] = 'no-store'
        return toServiceResponse(set, await offboardingService.getJob(db(), params.jobId))
      }
    )
    .post(
      '/api/admin/tenant-deletions/:jobId/confirm',
      {
        auth: true,
        params: t.Object({ jobId: t.String({ minLength: 1 }) }),
        body: t.Object({
          /** Must equal the tenant's slug exactly. */
          tenantSlug: t.String({ minLength: 1 }),
          /** `exportId` from a complete export receipt taken after the request. */
          exportId: t.String({ minLength: 1 }),
        }),
      },
      async ({ user, params, body, set }) => {
        const denied = forbidUnlessSuperAdmin(user, set)
        if (denied) return denied
        const result = await offboardingService.confirmDeletion(db(), params.jobId, body, user.id, deps())
        set.headers['cache-control'] = 'no-store'
        return toServiceResponse(set, result, { errorStatusMap: ERROR_STATUS })
      }
    )
    .post(
      '/api/admin/tenant-deletions/:jobId/resume',
      { auth: true, params: t.Object({ jobId: t.String({ minLength: 1 }) }) },
      async ({ user, params, set }) => {
        const denied = forbidUnlessSuperAdmin(user, set)
        if (denied) return denied
        const result = await offboardingService.runDeletion(db(), params.jobId, deps())
        set.headers['cache-control'] = 'no-store'
        return toServiceResponse(set, result, { errorStatusMap: ERROR_STATUS })
      }
    )
    .post(
      '/api/admin/tenant-deletions/:jobId/cancel',
      { auth: true, params: t.Object({ jobId: t.String({ minLength: 1 }) }) },
      async ({ user, params, set }) => {
        const denied = forbidUnlessSuperAdmin(user, set)
        if (denied) return denied
        const result = await offboardingService.cancelDeletion(db(), params.jobId, user.id, deps())
        set.headers['cache-control'] = 'no-store'
        return toServiceResponse(set, result, { errorStatusMap: ERROR_STATUS })
      }
    )
}
