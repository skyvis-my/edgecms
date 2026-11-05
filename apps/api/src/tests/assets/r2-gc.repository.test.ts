import { describe, expect, it, vi, beforeEach } from 'bun:test'
import type { Database } from '@/database/db'
import { r2GcRepository, sweepR2GcOutbox, type R2GcRow } from '../../assets/r2-gc.repository'

function chainableSelect(rows: unknown[]) {
  const all = vi.fn(async () => rows)
  const limit = vi.fn(() => ({ all }))
  const orderBy = vi.fn(() => ({ limit, all }))
  const where = vi.fn(() => ({ orderBy, limit, all }))
  const from = vi.fn(() => ({ where }))
  return { select: vi.fn(() => ({ from })), all, limit, orderBy, where }
}

function chainableUpdate() {
  const where = vi.fn(async () => undefined)
  const set = vi.fn(() => ({ where }))
  return { update: vi.fn(() => ({ set })), set, where }
}

describe('r2GcRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enqueueKeys inserts one row per unique key', async () => {
    const onConflictDoNothing = vi.fn(async () => undefined)
    const values: ReturnType<typeof vi.fn> = vi.fn(() => ({ onConflictDoNothing }))
    const db = { insert: vi.fn(() => ({ values })) }

    const ok = await r2GcRepository.enqueueKeys(db as unknown as Database, 't1', [
      'k1',
      'k2',
      'k1',
      '',
    ])

    expect(ok).toBe(true)
    expect(db.insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledTimes(1)
    const rows = (values.mock.calls[0] as unknown as [{ objectKey: string; tenantId: string }[]])[0]
    expect(rows.map((r) => r.objectKey).sort()).toEqual(['k1', 'k2'])
    expect(rows[0]?.tenantId).toBe('t1')
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1)
  })

  it('enqueueKeys returns true without touching the DB when empty', async () => {
    const db = { insert: vi.fn() }
    const ok = await r2GcRepository.enqueueKeys(db as unknown as Database, 't1', [])
    expect(ok).toBe(true)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('enqueueKeys returns false on drivers without insert', async () => {
    const ok = await r2GcRepository.enqueueKeys({} as Database, 't1', ['k1'])
    expect(ok).toBe(false)
  })

  it('claimPending returns due rows oldest-first with limit', async () => {
    const rows: R2GcRow[] = [
      { id: 'a', tenantId: 't1', objectKey: 'k1', status: 'pending', attempts: 0, nextAttemptAt: null, createdAt: '2024-01-01' },
      { id: 'b', tenantId: 't1', objectKey: 'k2', status: 'pending', attempts: 0, nextAttemptAt: null, createdAt: '2024-01-02' },
    ]
    const { select, orderBy, limit } = chainableSelect(rows)
    const db = { select }

    const claimed = await r2GcRepository.claimPending(db as unknown as Database, 10)

    expect(claimed).toEqual(rows)
    expect(orderBy).toHaveBeenCalledTimes(1)
    expect(limit).toHaveBeenCalledWith(10)
  })

  it('claimPending returns empty on drivers without select', async () => {
    const claimed = await r2GcRepository.claimPending({} as Database, 10)
    expect(claimed).toEqual([])
  })

  it('markSentByKey and markFailedByKey update by object key', async () => {
    const { update, set, where } = chainableUpdate()
    const db = { update }

    await r2GcRepository.markSentByKey(db as unknown as Database, 'k1')
    expect(update).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', nextAttemptAt: null })
    )
    expect(where).toHaveBeenCalledTimes(1)

    await r2GcRepository.markFailedByKey(db as unknown as Database, 'k2')
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', nextAttemptAt: expect.any(String) })
    )
  })
})

describe('sweepR2GcOutbox', () => {
  it('deletes claimed keys and marks them sent', async () => {
    const rows = [
      { id: 'a', objectKey: 'k1', status: 'pending' },
      { id: 'b', objectKey: 'k2', status: 'pending' },
    ]
    const { select } = chainableSelect(rows)
    const { update } = chainableUpdate()
    const db = { select, update }
    const r2 = { delete: vi.fn(async () => undefined) }

    const result = await sweepR2GcOutbox(
      db as unknown as Database,
      r2 as unknown as Pick<R2Bucket, 'delete'>
    )

    expect(result).toEqual({ deleted: 2, failed: 0 })
    expect(r2.delete).toHaveBeenCalledTimes(2)
  })

  it('marks failed keys for retry and reports counts', async () => {
    const rows = [
      { id: 'a', objectKey: 'k1', status: 'pending' },
      { id: 'b', objectKey: 'k2', status: 'pending' },
    ]
    const { select } = chainableSelect(rows)
    const { update, set } = chainableUpdate()
    const db = { select, update }
    const r2 = {
      delete: vi.fn(async (key: string) => {
        if (key === 'k1') throw new Error('R2 boom')
      }),
    }

    const result = await sweepR2GcOutbox(
      db as unknown as Database,
      r2 as unknown as Pick<R2Bucket, 'delete'>
    )

    expect(result).toEqual({ deleted: 1, failed: 1 })
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', nextAttemptAt: expect.any(String) })
    )
  })

  it('returns zero counts when nothing is pending', async () => {
    const { select } = chainableSelect([])
    const db = { select }
    const r2 = { delete: vi.fn() }

    const result = await sweepR2GcOutbox(
      db as unknown as Database,
      r2 as unknown as Pick<R2Bucket, 'delete'>
    )

    expect(result).toEqual({ deleted: 0, failed: 0 })
    expect(r2.delete).not.toHaveBeenCalled()
  })
})

describe('sweepR2GcOutbox tenant prefix rows (HS-09)', () => {
  function prefixRow(objectKey: string): R2GcRow {
    return { id: 'p', tenantId: 't1', objectKey, status: 'pending', attempts: 0, nextAttemptAt: null, createdAt: '2024-01-01' }
  }

  function dbWith(rows: R2GcRow[]) {
    const { select } = chainableSelect(rows)
    const { update, set } = chainableUpdate()
    return { db: { select, update } as unknown as Database, set }
  }

  it('deletes one listing per sweep and keeps the row due while objects remain', async () => {
    const { db, set } = dbWith([prefixRow('tenants/t1/')])
    const list = vi.fn(async () => ({
      objects: [{ key: 'tenants/t1/a.png' }, { key: 'tenants/t1/b.png' }, { key: 'tenants/t10/x.png' }],
      truncated: true,
    }))
    const del = vi.fn(async () => undefined)

    const result = await sweepR2GcOutbox(db, { list, delete: del } as never)

    expect(result).toEqual({ deleted: 1, failed: 0 })
    expect(list).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'tenants/t1/' }))
    expect(del).toHaveBeenCalledWith(['tenants/t1/a.png', 'tenants/t1/b.png'])
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', nextAttemptAt: null }))
    expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }))
  })

  it('marks the prefix row sent once the listing is not truncated', async () => {
    const { db, set } = dbWith([prefixRow('tenants/t1/')])
    const list = vi.fn(async () => ({ objects: [], truncated: false }))
    const del = vi.fn(async () => undefined)

    await sweepR2GcOutbox(db, { list, delete: del } as never)

    expect(del).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }))
  })

  it('refuses prefixes that are not a single tenant prefix', async () => {
    for (const key of ['tenants/', 'tenants/t1/assets/', '/', 'other/t1/']) {
      const { db, set } = dbWith([prefixRow(key)])
      const list = vi.fn(async () => ({ objects: [{ key: 'tenants/t1/a.png' }], truncated: false }))
      const del = vi.fn(async () => undefined)

      const result = await sweepR2GcOutbox(db, { list, delete: del } as never)

      expect(result).toEqual({ deleted: 0, failed: 1 })
      expect(list).not.toHaveBeenCalled()
      expect(del).not.toHaveBeenCalled()
      expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }))
    }
  })
})
