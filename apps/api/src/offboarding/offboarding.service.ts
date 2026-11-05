import { sql } from 'drizzle-orm'
import { AUDIT_GLOBAL_SCOPE } from '@/audit/audit-chain'
import { auditService } from '@/audit/audit.service'
import { bumpPermissionRevision } from '@/auth/auth-revision'
import { invalidateByTags } from '@/cache/invalidation.service'
import type { Database } from '@/database/db'
import type { TenantDeletionJobRow } from '@/database/schema'
import type { TenantEventPublisher } from '@/host/tenant-events'
import { logger } from '@/observability/logger'
import type { ServiceResult } from '@/shared/utils/service-response'
import { invalidateCorsCache } from '@/tenants/cors-cache'
import { clearTenantIsolateCache } from '@/tenants/tenant-cache'
import { tenantsService } from '@/tenants/tenants.service'
import { offboardingRepository, tenantR2Prefix } from './offboarding.repository'
import { TENANT_DELETION_ORDER, tenantCacheTagPrefix } from './tenant-data-map'

export const TENANT_DELETED_ACTION = 'tenant.data_deleted'
/** A run gives up its lease after this long, so a crashed run can be resumed. */
export const DELETION_LEASE_MS = 60_000
const DEFAULT_MAX_CHUNKS = 400
const DEFAULT_MAX_RUN_MS = 20_000

export type OffboardingDeps = {
  events?: Pick<TenantEventPublisher, 'publish'>
  kv?: KVNamespace
  retentionDays?: number
  now?: () => Date
  /** Per-run work budget; the job stays `confirmed` and resumable when it runs out. */
  maxChunks?: number
  maxRunMs?: number
}

export type OffboardingErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DEDICATED_RESOURCES_UNSUPPORTED'
  | 'CONFIRMATION_MISMATCH'
  | 'EXPORT_RECEIPT_NOT_FOUND'
  | 'EXPORT_RECEIPT_STALE'
  | 'JOB_BUSY'
  | 'DELETION_FAILED'

type OffboardingError = { code: OffboardingErrorCode; message: string }

export type DeletionJobView = {
  id: string
  tenantId: string
  tenantSlug: string
  tenantName: string
  status: string
  done: boolean
  requestedBy: string
  requestedAt: string
  exportId: string | null
  confirmedBy: string | null
  confirmedAt: string | null
  completedAt: string | null
  counts: Record<string, number>
  r2: { objectsQueued: number; prefix: string; queuedAt: string | null }
  receipt: { auditEventId: string } | null
  lastError: string | null
}

function fail(code: OffboardingErrorCode, message: string): ServiceResult<never, OffboardingError> {
  return { success: false, error: { code, message } }
}

function view(job: TenantDeletionJobRow): DeletionJobView {
  return {
    id: job.id,
    tenantId: job.tenantId,
    tenantSlug: job.tenantSlug,
    tenantName: job.tenantName,
    status: job.status,
    done: job.status === 'completed',
    requestedBy: job.requestedBy,
    requestedAt: job.requestedAt,
    exportId: job.exportId,
    confirmedBy: job.confirmedBy,
    confirmedAt: job.confirmedAt,
    completedAt: job.completedAt,
    counts: job.counts ?? {},
    r2: {
      objectsQueued: job.r2ObjectsQueued,
      prefix: tenantR2Prefix(job.tenantId),
      queuedAt: job.r2QueuedAt,
    },
    receipt: job.receiptAuditEventId ? { auditEventId: job.receiptAuditEventId } : null,
    lastError: job.lastError,
  }
}

function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : String(err)
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(message)
}

async function audit(
  db: Database,
  deps: OffboardingDeps,
  action: string,
  actorId: string,
  job: TenantDeletionJobRow,
  metadata: Record<string, unknown> = {}
) {
  await auditService.recordSafely(
    db,
    {
      scope: AUDIT_GLOBAL_SCOPE,
      category: 'super_admin',
      action,
      outcome: 'success',
      actorId,
      actorSource: 'user',
      targetType: 'tenant',
      targetId: job.tenantId,
      metadata: { jobId: job.id, tenantSlug: job.tenantSlug, ...metadata },
    },
    { retentionDays: deps.retentionDays }
  )
}

/** Bump snapshot versions for the tenant's collections so no stale KV snapshot outlives it. */
async function invalidateTenantSnapshots(db: Database, kv: KVNamespace, tenantId: string) {
  const prefix = tenantCacheTagPrefix(tenantId)
  // Prefix match with substr, so tenant ids never act as LIKE wildcards.
  const rows = await db.all<{ tag: string }>(
    sql`SELECT DISTINCT "tag" FROM "cache_tags" WHERE substr("tag", 1, ${prefix.length}) = ${prefix}`
  )
  if (rows.length > 0) await invalidateByTags(db, kv, rows.map((row) => row.tag))
}

export const offboardingService = {
  async getJob(db: Database, jobId: string): Promise<ServiceResult<DeletionJobView, OffboardingError>> {
    const job = await offboardingRepository.findJob(db, jobId)
    return job ? { success: true, data: view(job) } : fail('NOT_FOUND', 'Deletion job not found')
  },

  /**
   * Step 1: open a deletion job. Suspends an active tenant so admin writes
   * stop and the export taken next is complete. Deletes nothing. Returns the
   * open job when one exists (idempotent).
   */
  async requestDeletion(
    db: Database,
    tenantSlug: string,
    actorId: string,
    deps: OffboardingDeps = {}
  ): Promise<ServiceResult<DeletionJobView, OffboardingError>> {
    const tenant = await offboardingRepository.findTenant(db, tenantSlug)
    if (!tenant) return fail('NOT_FOUND', `Tenant '${tenantSlug}' not found`)

    const resources = await offboardingRepository.findResources(db, tenant.id)
    if (resources && (resources.d1DatabaseId || resources.kvNamespaceId || resources.r2BucketName)) {
      return fail(
        'DEDICATED_RESOURCES_UNSUPPORTED',
        'Tenant has dedicated D1/KV/R2 resources; HS-09 deletion covers shared-mode tenants only'
      )
    }

    const open = await offboardingRepository.findOpenJob(db, tenant.id)
    if (open) return { success: true, data: view(open) }

    const now = (deps.now?.() ?? new Date()).toISOString()
    const job: TenantDeletionJobRow = {
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      previousStatus: tenant.status,
      status: 'requested',
      requestedBy: actorId,
      requestedAt: now,
      exportId: null,
      confirmedBy: null,
      confirmedAt: null,
      counts: {},
      r2ObjectsQueued: 0,
      r2QueuedAt: null,
      receiptAuditEventId: null,
      eventEmittedAt: null,
      leaseUntil: null,
      lastError: null,
      completedAt: null,
      updatedAt: now,
    }
    try {
      await offboardingRepository.insertJob(db, job)
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      const raced = await offboardingRepository.findOpenJob(db, tenant.id)
      if (raced) return { success: true, data: view(raced) }
      throw err
    }

    if (tenant.status === 'active') {
      await tenantsService.update(db, tenant.id, { status: 'suspended' }, {
        events: deps.events as TenantEventPublisher | undefined,
        actorId,
      })
    }
    await audit(db, deps, 'tenant.deletion_requested', actorId, job, {
      previousStatus: tenant.status,
    })
    return { success: true, data: view(job) }
  },

  /** Cancel a job that is not confirmed yet; restores the status the request changed. */
  async cancelDeletion(
    db: Database,
    jobId: string,
    actorId: string,
    deps: OffboardingDeps = {}
  ): Promise<ServiceResult<DeletionJobView, OffboardingError>> {
    const job = await offboardingRepository.findJob(db, jobId)
    if (!job) return fail('NOT_FOUND', 'Deletion job not found')
    if (job.status === 'cancelled') return { success: true, data: view(job) }
    const cancelled = await offboardingRepository.transition(db, jobId, 'requested', {
      status: 'cancelled',
    })
    if (!cancelled) return fail('CONFLICT', `Deletion job is ${job.status}; it can no longer be cancelled`)

    const tenant = await offboardingRepository.findTenant(db, job.tenantId)
    if (tenant && tenant.status === 'suspended' && job.previousStatus === 'active') {
      await tenantsService.update(db, tenant.id, { status: 'active' }, {
        events: deps.events as TenantEventPublisher | undefined,
        actorId,
      })
    }
    await audit(db, deps, 'tenant.deletion_cancelled', actorId, job)
    const updated = await offboardingRepository.findJob(db, jobId)
    return { success: true, data: view(updated ?? job) }
  },

  /**
   * Step 2: confirm with the exact tenant slug and the id of an export
   * receipt taken after the request, then run the deletion. Retrying a
   * confirmed or completed job with the same export id resumes or returns it.
   */
  async confirmDeletion(
    db: Database,
    jobId: string,
    confirmation: { tenantSlug: string; exportId: string },
    actorId: string,
    deps: OffboardingDeps = {}
  ): Promise<ServiceResult<DeletionJobView, OffboardingError>> {
    const job = await offboardingRepository.findJob(db, jobId)
    if (!job) return fail('NOT_FOUND', 'Deletion job not found')
    if (confirmation.tenantSlug !== job.tenantSlug) {
      return fail('CONFIRMATION_MISMATCH', 'tenantSlug does not match the tenant of this job')
    }
    if (job.status === 'cancelled') return fail('CONFLICT', 'Deletion job was cancelled')
    if (job.status === 'confirmed' || job.status === 'completed') {
      if (job.exportId !== confirmation.exportId) {
        return fail('CONFLICT', 'Deletion job was already confirmed with another export')
      }
      return job.status === 'completed'
        ? { success: true, data: view(job) }
        : this.runDeletion(db, jobId, deps)
    }

    const receipt = await offboardingRepository.findExportReceipt(
      db,
      job.tenantId,
      confirmation.exportId
    )
    if (!receipt) {
      return fail('EXPORT_RECEIPT_NOT_FOUND', 'No completed export with this id for this tenant')
    }
    if (receipt.occurredAt < job.requestedAt) {
      return fail(
        'EXPORT_RECEIPT_STALE',
        'Export was taken before the deletion request; export the tenant again'
      )
    }

    const now = (deps.now?.() ?? new Date()).toISOString()
    const confirmed = await offboardingRepository.transition(db, jobId, 'requested', {
      status: 'confirmed',
      exportId: confirmation.exportId,
      confirmedBy: actorId,
      confirmedAt: now,
    })
    if (!confirmed) return this.confirmDeletion(db, jobId, confirmation, actorId, deps)
    await audit(db, deps, 'tenant.deletion_confirmed', actorId, job, {
      exportId: confirmation.exportId,
    })
    return this.runDeletion(db, jobId, deps)
  },

  /**
   * Run (or resume) a confirmed job: queue R2 cleanup, delete every
   * tenant-scoped row in `TENANT_DELETION_ORDER` chunk by chunk, then write
   * the audit receipt, emit `tenant.deleted` and mark the job completed.
   * Every step is idempotent; a run that runs out of budget or fails leaves
   * the job `confirmed` for `resume`.
   */
  async runDeletion(
    db: Database,
    jobId: string,
    deps: OffboardingDeps = {}
  ): Promise<ServiceResult<DeletionJobView, OffboardingError>> {
    const clock = deps.now ?? (() => new Date())
    const initial = await offboardingRepository.findJob(db, jobId)
    if (!initial) return fail('NOT_FOUND', 'Deletion job not found')
    if (initial.status === 'completed') return { success: true, data: view(initial) }
    if (initial.status !== 'confirmed') {
      return fail('CONFLICT', `Deletion job is ${initial.status}; confirm it first`)
    }
    if (!(await offboardingRepository.acquireLease(db, jobId, clock(), DELETION_LEASE_MS))) {
      return fail('JOB_BUSY', 'Another run of this deletion job is in progress; retry shortly')
    }

    const started = Date.now()
    const maxChunks = deps.maxChunks ?? DEFAULT_MAX_CHUNKS
    const maxRunMs = deps.maxRunMs ?? DEFAULT_MAX_RUN_MS
    let chunks = 0
    const tenantId = initial.tenantId

    try {
      if (!initial.r2QueuedAt) {
        if (deps.kv) {
          await invalidateTenantSnapshots(db, deps.kv, tenantId).catch((err) => {
            logger.warn('tenant_offboarding_cache_invalidation_failed', {
              tenantId,
              error: err instanceof Error ? err.message : String(err),
            })
          })
        }
        await offboardingRepository.queueR2Cleanup(db, jobId, tenantId, clock().toISOString())
      }

      for (const rule of TENANT_DELETION_ORDER) {
        for (;;) {
          if (chunks >= maxChunks || Date.now() - started >= maxRunMs) {
            await offboardingRepository.releaseLease(db, jobId)
            const paused = await offboardingRepository.findJob(db, jobId)
            return { success: true, data: view(paused ?? initial) }
          }
          const deleted = await offboardingRepository.deleteChunk(db, jobId, rule.table, tenantId)
          if (deleted === 0) break
          // Only chunks that removed rows spend budget, so a resumed run does not
          // exhaust its budget re-checking tables an earlier run already emptied.
          chunks += 1
        }
      }

      let job = (await offboardingRepository.findJob(db, jobId)) ?? initial
      if (!job.receiptAuditEventId) {
        const receipt = await auditService.append(
          db,
          {
            scope: AUDIT_GLOBAL_SCOPE,
            category: 'super_admin',
            action: TENANT_DELETED_ACTION,
            outcome: 'success',
            actorId: job.confirmedBy,
            actorSource: 'user',
            targetType: 'tenant',
            targetId: tenantId,
            metadata: {
              jobId,
              tenantSlug: job.tenantSlug,
              exportId: job.exportId,
              requestedBy: job.requestedBy,
              counts: job.counts,
              r2: { objectsQueued: job.r2ObjectsQueued, prefix: tenantR2Prefix(tenantId) },
            },
          },
          { retentionDays: deps.retentionDays }
        )
        await offboardingRepository.patchJob(db, jobId, { receiptAuditEventId: receipt.id })
      }

      if (!job.eventEmittedAt) {
        await deps.events?.publish(
          'tenant.deleted',
          { id: tenantId, slug: job.tenantSlug, name: job.tenantName, status: 'deleted' },
          { actorId: job.confirmedBy ?? undefined }
        )
        await offboardingRepository.patchJob(db, jobId, { eventEmittedAt: clock().toISOString() })
      }

      invalidateCorsCache(job.tenantSlug)
      clearTenantIsolateCache(job.tenantSlug)
      await bumpPermissionRevision(deps.kv, tenantId).catch(() => 0)

      await offboardingRepository.transition(db, jobId, 'confirmed', {
        status: 'completed',
        completedAt: clock().toISOString(),
        leaseUntil: null,
        lastError: null,
      })
      job = (await offboardingRepository.findJob(db, jobId)) ?? job
      return { success: true, data: view(job) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('tenant_offboarding_run_failed', { jobId, tenantId, error: message })
      await offboardingRepository
        .patchJob(db, jobId, { lastError: message.slice(0, 500), leaseUntil: null })
        .catch(() => undefined)
      return fail('DELETION_FAILED', 'Deletion stopped before finishing; resume the job to continue')
    }
  },
}
