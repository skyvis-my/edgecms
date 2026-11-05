import { describe, expect, it, vi } from 'bun:test'
import { auditService } from '@/audit/audit.service'
import type { Database } from '@/database/db'
import { offboardingRepository } from '@/offboarding/offboarding.repository'
import { offboardingService, TENANT_DELETED_ACTION } from '@/offboarding/offboarding.service'
import { TENANT_DELETION_ORDER } from '@/offboarding/tenant-data-map'
import { tenantExportLines } from '@/offboarding/tenant-export'
import { createOffboardingFixture, tenantRowCounts } from './offboarding-test-seed'

const ROOT = 'root-admin'

function recorder() {
  const published: Array<{ event: string; tenant: { id: string; status: string } }> = []
  return {
    published,
    events: {
      publish: vi.fn(async (event: string, tenant: { id: string; status: string }) => {
        published.push({ event, tenant })
      }),
    },
  }
}

async function exportTenant(db: Database, slug: string, exportId = crypto.randomUUID()) {
  const tenant = await offboardingRepository.findTenant(db, slug)
  const lines: Array<Record<string, unknown>> = []
  for await (const line of tenantExportLines(db, tenant!, {
    exportId,
    actorId: ROOT,
    requestedBy: 'super_admin',
  })) {
    lines.push(JSON.parse(line))
  }
  return { exportId, lines }
}

function tenantStatus(sqlite: ReturnType<typeof createOffboardingFixture>['sqlite'], id: string) {
  return (sqlite.query(`SELECT status FROM tenants WHERE id = ?`).get(id) as { status: string } | null)
    ?.status
}

describe('HS-09 tenant export', () => {
  it('exports content, versions, schema, media keys and settings with webhook secrets redacted', async () => {
    const { db } = createOffboardingFixture()
    const { lines } = await exportTenant(db, 'one')
    const types = lines.map((line) => line.type)
    expect(types[0]).toBe('header')
    expect(types[1]).toBe('tenant')
    expect(types[types.length - 1]).toBe('receipt')
    for (const type of ['collection', 'entry', 'entry_version', 'asset', 'asset_variant', 'webhook', 'member', 'role', 'permission', 'relation', 'schema_snapshot']) {
      expect(types).toContain(type)
    }
    const data = (type: string) =>
      lines.filter((line) => line.type === type).map((line) => line.data as Record<string, unknown>)
    expect(data('entry').map((e) => e.id).sort()).toEqual(['t1-e1', 't1-e2'])
    expect(data('asset')[0]?.originalKey).toBe('tenants/t1/assets/t1-a1/original/hero.png')
    expect(data('asset_variant')[0]?.objectKey).toBe('tenants/t1/assets/t1-a1/variants/thumb.webp')
    expect(data('webhook')[0]).toMatchObject({
      url: 'https://hooks.example.com/t1',
      secret: '[redacted]',
      headers: { Authorization: '[redacted]' },
    })

    const serialized = JSON.stringify(lines)
    expect(serialized).not.toContain('whsec-t1-signing')
    expect(serialized).not.toContain('hook-token-t1')
    // Never another tenant's rows.
    expect(serialized).not.toContain('t2-')
  })

  it('pages through large tables and records the receipt with counts in the global chain', async () => {
    const { db } = createOffboardingFixture({ extraEntries: 450 })
    const { exportId, lines } = await exportTenant(db, 'one')
    expect(lines.filter((line) => line.type === 'entry')).toHaveLength(452)
    const receipt = lines[lines.length - 1] as {
      exportId: string
      counts: Record<string, number>
      auditEventId: string
      sha256: string
    }
    expect(receipt.exportId).toBe(exportId)
    expect(receipt.counts.entry).toBe(452)
    expect(receipt.sha256).toMatch(/^[0-9a-f]{64}$/)

    const stored = await offboardingRepository.findExportReceipt(db, 't1', exportId)
    expect(stored?.id).toBe(receipt.auditEventId)
    expect((stored!.metadata as { counts: Record<string, number> }).counts.entry).toBe(452)
  })

  it('issues no receipt when the download stops early', async () => {
    const { db } = createOffboardingFixture()
    const tenant = await offboardingRepository.findTenant(db, 'one')
    const exportId = crypto.randomUUID()
    const lines = tenantExportLines(db, tenant!, { exportId, actorId: ROOT, requestedBy: 'owner' })
    await lines.next()
    await lines.next()
    await lines.return(undefined)
    expect(await offboardingRepository.findExportReceipt(db, 't1', exportId)).toBeNull()
  })
})

describe('HS-09 deletion request and confirmation', () => {
  it('request suspends the tenant, deletes nothing and is idempotent', async () => {
    const { db, sqlite } = createOffboardingFixture()
    const before = await tenantRowCounts(db, 't1')
    const { events, published } = recorder()

    const first = await offboardingService.requestDeletion(db, 'one', ROOT, { events })
    const second = await offboardingService.requestDeletion(db, 'one', ROOT, { events })
    expect(first.success && second.success).toBe(true)
    if (!first.success || !second.success) return
    expect(second.data.id).toBe(first.data.id)
    expect(first.data.status).toBe('requested')
    expect(tenantStatus(sqlite, 't1')).toBe('suspended')
    expect(published.map((p) => p.event)).toEqual(['tenant.suspended'])
    expect(await tenantRowCounts(db, 't1')).toEqual(before)
  })

  it('refuses tenants with dedicated resources', async () => {
    const { db, sqlite } = createOffboardingFixture()
    sqlite.run(`UPDATE tenant_resources SET d1DatabaseId = 'd1-abc' WHERE tenantId = 't1'`)
    const result = await offboardingService.requestDeletion(db, 'one', ROOT)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('DEDICATED_RESOURCES_UNSUPPORTED')
  })

  it('never deletes without the exact slug and a receipt taken after the request', async () => {
    const { db } = createOffboardingFixture()
    const early = await exportTenant(db, 'one')
    const before = await tenantRowCounts(db, 't1')
    const requested = await offboardingService.requestDeletion(db, 'one', ROOT, {
      now: () => new Date(Date.now() + 1000),
    })
    if (!requested.success) throw new Error('request failed')
    const jobId = requested.data.id
    const otherTenantExport = await exportTenant(db, 'two')

    const attempts = [
      { tenantSlug: 'ONE', exportId: early.exportId },
      { tenantSlug: 'two', exportId: otherTenantExport.exportId },
      { tenantSlug: 'one', exportId: 'not-a-receipt' },
      { tenantSlug: 'one', exportId: otherTenantExport.exportId },
      { tenantSlug: 'one', exportId: early.exportId },
    ]
    const codes = []
    for (const attempt of attempts) {
      const result = await offboardingService.confirmDeletion(db, jobId, attempt, ROOT)
      codes.push(result.success ? 'deleted' : result.error.code)
    }
    expect(codes).toEqual([
      'CONFIRMATION_MISMATCH',
      'CONFIRMATION_MISMATCH',
      'EXPORT_RECEIPT_NOT_FOUND',
      'EXPORT_RECEIPT_NOT_FOUND',
      'EXPORT_RECEIPT_STALE',
    ])
    expect(await tenantRowCounts(db, 't1')).toEqual(before)
  })

  it('cancel restores the previous status; a cancelled job cannot be confirmed', async () => {
    const { db, sqlite } = createOffboardingFixture()
    const requested = await offboardingService.requestDeletion(db, 'one', ROOT)
    if (!requested.success) throw new Error('request failed')
    const cancelled = await offboardingService.cancelDeletion(db, requested.data.id, ROOT)
    expect(cancelled.success && cancelled.data.status).toBe('cancelled')
    expect(tenantStatus(sqlite, 't1')).toBe('active')
    const confirm = await offboardingService.confirmDeletion(
      db,
      requested.data.id,
      { tenantSlug: 'one', exportId: (await exportTenant(db, 'one')).exportId },
      ROOT
    )
    expect(confirm.success).toBe(false)

    const again = await offboardingService.requestDeletion(db, 'one', ROOT)
    if (!again.success) throw new Error('request failed')
    expect(again.data.id).not.toBe(requested.data.id)
  })
})

describe('HS-09 verified deletion job', () => {
  async function confirmableJob(
    fixture: ReturnType<typeof createOffboardingFixture>,
    deps: Parameters<typeof offboardingService.requestDeletion>[3] = {}
  ) {
    const requested = await offboardingService.requestDeletion(fixture.db, 'one', ROOT, deps)
    if (!requested.success) throw new Error('request failed')
    const { exportId } = await exportTenant(fixture.db, 'one')
    return { jobId: requested.data.id, exportId }
  }

  it('deletes every tenant-scoped row, keeps other tenants, queues R2 and writes a receipt', async () => {
    const fixture = createOffboardingFixture()
    const { db, sqlite } = fixture
    const before = await tenantRowCounts(db, 't1')
    // Every tenant table must be seeded, so a new table without seed data fails here.
    const unseeded = Object.entries(before)
      .filter(([, n]) => n === 0)
      .map(([table]) => table)
    expect(unseeded).toEqual([])
    const otherBefore = await tenantRowCounts(db, 't2')
    const { events, published } = recorder()

    const { jobId, exportId } = await confirmableJob(fixture, { events })
    const result = await offboardingService.confirmDeletion(
      db,
      jobId,
      { tenantSlug: 'one', exportId },
      ROOT,
      { events }
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.status).toBe('completed')
    expect(result.data.done).toBe(true)

    const after = await tenantRowCounts(db, 't1')
    expect(Object.values(after).every((n) => n === 0)).toBe(true)
    expect(await tenantRowCounts(db, 't2')).toEqual(otherBefore)
    // Per-table counts equal what was there (the request changed no rows).
    expect(result.data.counts).toEqual(before)
    expect(Object.keys(result.data.counts).sort()).toEqual(
      TENANT_DELETION_ORDER.map((r) => r.table).sort()
    )

    const queued = (
      sqlite
        .query(`SELECT object_key FROM r2_gc_outbox WHERE tenant_id = 't1' ORDER BY object_key`)
        .all() as { object_key: string }[]
    ).map((r) => r.object_key)
    expect(queued).toEqual([
      'imports/t1/source.docx',
      'tenants/t1/',
      'tenants/t1/assets/t1-a1/original/hero.png',
      'tenants/t1/assets/t1-a1/variants/thumb.webp',
    ])
    expect(result.data.r2.objectsQueued).toBe(3)

    expect(published.map((p) => p.event)).toEqual(['tenant.suspended', 'tenant.deleted'])
    const page = await auditService.exportPage(db, 'global', 0, 100)
    const receipt = page.events.find((e) => e.action === TENANT_DELETED_ACTION)
    expect(receipt?.id).toBe(result.data.receipt!.auditEventId)
    expect((receipt!.metadata as { counts: Record<string, number> }).counts).toEqual(before)
    expect((await auditService.verify(db, 'global')).valid).toBe(true)
    // Global users survive; only memberships went.
    expect(sqlite.query(`SELECT COUNT(*) n FROM user`).get()).toEqual({ n: 3 })
  })

  it('is resumable: small budgets finish over several runs with exact counts and one event', async () => {
    const fixture = createOffboardingFixture({ extraEntries: 1200 })
    const before = await tenantRowCounts(fixture.db, 't1')
    const { events, published } = recorder()
    const { jobId, exportId } = await confirmableJob(fixture, { events })

    let result = await offboardingService.confirmDeletion(
      fixture.db,
      jobId,
      { tenantSlug: 'one', exportId },
      ROOT,
      { events, maxChunks: 3 }
    )
    let runs = 1
    while (result.success && !result.data.done) {
      expect(result.data.status).toBe('confirmed')
      result = await offboardingService.runDeletion(fixture.db, jobId, { events, maxChunks: 3 })
      runs += 1
      if (runs > 100) throw new Error('job never finished')
    }
    expect(runs).toBeGreaterThan(3)
    expect(result.success && result.data.counts).toEqual(before)
    expect(before.entries).toBe(1202)
    expect(published.filter((p) => p.event === 'tenant.deleted')).toHaveLength(1)

    // Retrying confirm or resume after completion changes nothing.
    const retry = await offboardingService.confirmDeletion(
      fixture.db,
      jobId,
      { tenantSlug: 'one', exportId },
      ROOT,
      { events }
    )
    expect(retry.success && retry.data.status).toBe('completed')
    await offboardingService.runDeletion(fixture.db, jobId, { events })
    expect(published.filter((p) => p.event === 'tenant.deleted')).toHaveLength(1)
  })

  it('a failed run keeps the job resumable and writes the receipt once', async () => {
    const fixture = createOffboardingFixture()
    const { jobId, exportId } = await confirmableJob(fixture)
    const failing = {
      publish: vi.fn(async () => {
        throw new Error('listener down')
      }),
    }

    const failed = await offboardingService.confirmDeletion(
      fixture.db,
      jobId,
      { tenantSlug: 'one', exportId },
      ROOT,
      { events: failing }
    )
    expect(failed.success).toBe(false)
    if (!failed.success) expect(failed.error.code).toBe('DELETION_FAILED')
    const stuck = await offboardingRepository.findJob(fixture.db, jobId)
    expect(stuck?.status).toBe('confirmed')
    expect(stuck?.lastError).toContain('listener down')
    expect(stuck?.leaseUntil).toBeNull()

    const { events, published } = recorder()
    const resumed = await offboardingService.runDeletion(fixture.db, jobId, { events })
    expect(resumed.success && resumed.data.status).toBe('completed')
    expect(published.map((p) => p.event)).toEqual(['tenant.deleted'])
    const page = await auditService.exportPage(fixture.db, 'global', 0, 100)
    expect(page.events.filter((e) => e.action === TENANT_DELETED_ACTION)).toHaveLength(1)
  })

  it('refuses a second concurrent run', async () => {
    const fixture = createOffboardingFixture()
    const { jobId, exportId } = await confirmableJob(fixture)
    await offboardingRepository.transition(fixture.db, jobId, 'requested', {
      status: 'confirmed',
      exportId,
    })
    expect(await offboardingRepository.acquireLease(fixture.db, jobId, new Date(), 60_000)).toBe(true)
    const result = await offboardingService.runDeletion(fixture.db, jobId)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('JOB_BUSY')
    expect((await tenantRowCounts(fixture.db, 't1')).tenants).toBe(1)
  })
})
