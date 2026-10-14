/**
 * Tests for the transactional webhook outbox repository (H1).
 *
 * H1: crash between DB commit and queue.sendBatch must not lose the webhook.
 * The outbox row is written atomically with the commit; double-enqueue of the
 * same eventId is a no-op (UNIQUE), and claim/mark round-trips drive relay.
 */
import { describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'

const { outboxRepository, outboxInsertValues, isUniqueConstraintViolation } = await import(
  `../../webhooks/outbox.repository?bypass=${Date.now()}`
)

const ENTRY = {
  eventId: 'evt-1',
  eventType: 'entry.created',
  payload: { event: 'entry.created', metadata: { syncChannel: 'global' }, after: { id: 'e1' } },
  tenantScope: 'global',
  commandId: 'cmd-1',
}

describe('outboxRepository', () => {
  it('dedupes double enqueue of the same eventId (UNIQUE as no-op)', async () => {
    const db = createUniqueEnforcingDb()
    await outboxRepository.enqueue(db as unknown as Database, ENTRY)
    await expect(
      outboxRepository.enqueue(db as unknown as Database, ENTRY)
    ).resolves.toBeUndefined()
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]).toMatchObject({ eventId: 'evt-1', status: 'pending' })
  })

  it('uses onConflictDoNothing when the driver supports it', async () => {
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn().mockReturnValue({ onConflictDoNothing })
    const db = { insert: vi.fn().mockReturnValue({ values }) }
    await outboxRepository.enqueue(db as unknown as Database, ENTRY)
    expect(values).toHaveBeenCalledTimes(1)
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1)
  })

  it('rethrows non-UNIQUE enqueue failures', async () => {
    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('connection reset')),
      }),
    }
    await expect(outboxRepository.enqueue(db as unknown as Database, ENTRY)).rejects.toThrow(
      'connection reset'
    )
  })

  it('claimPending returns pending rows oldest-first via full chain', async () => {
    const rows = [
      { eventId: 'evt-old', createdAt: '2025-01-01T00:00:00.000Z', status: 'pending' },
      { eventId: 'evt-new', createdAt: '2025-01-02T00:00:00.000Z', status: 'pending' },
    ]
    const { db, chain } = createSelectMock(rows)
    const claimed = await outboxRepository.claimPending(db as unknown as Database, 20)
    expect(claimed).toEqual(rows)
    expect(chain.orderBy).toHaveBeenCalledTimes(1)
    expect(chain.limit).toHaveBeenCalledWith(20)
    expect(chain.all).toHaveBeenCalledTimes(1)
  })

  it('claimPending caps rows with legacy drivers lacking orderBy/limit', async () => {
    const rows = [{ eventId: 'a' }, { eventId: 'b' }, { eventId: 'c' }]
    const all = vi.fn().mockResolvedValue(rows)
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ all }) }) }),
    }
    const claimed = await outboxRepository.claimPending(db as unknown as Database, 2)
    expect(claimed).toHaveLength(2)
  })

  it('markSent sets status sent and clears backoff', async () => {
    const { db, set, where } = createUpdateMock()
    await outboxRepository.markSent(db as unknown as Database, 'evt-1')
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent', nextAttemptAt: null })
    )
    expect(where).toHaveBeenCalledTimes(1)
  })

  it('markFailed keeps row pending with nextAttemptAt backoff', async () => {
    const { db, set } = createUpdateMock()
    const next = new Date(Date.now() + 60_000).toISOString()
    await outboxRepository.markFailed(db as unknown as Database, 'evt-1', next)
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', nextAttemptAt: next })
    )
  })

  it('markSent resolves without throwing on drivers lacking update', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      outboxRepository.markSent({} as unknown as Database, 'evt-1')
    ).resolves.toBeUndefined()
    warnSpy.mockRestore()
  })

  it('outboxInsertValues defaults tenantScope to global', () => {
    expect(outboxInsertValues({ eventId: 'e', eventType: 't', payload: {} })).toMatchObject({
      eventId: 'e',
      tenantScope: 'global',
      status: 'pending',
      attempts: 0,
    })
  })

  it('isUniqueConstraintViolation matches sqlite unique errors', () => {
    expect(isUniqueConstraintViolation(new Error('UNIQUE constraint failed'))).toBe(true)
    expect(isUniqueConstraintViolation(new Error('SQLITE_CONSTRAINT_UNIQUE'))).toBe(true)
    expect(isUniqueConstraintViolation(new Error('connection reset'))).toBe(false)
  })
})

function createUniqueEnforcingDb() {
  const rows: Record<string, unknown>[] = []
  return {
    rows,
    insert: vi.fn().mockReturnValue({
      values: vi.fn((v: Record<string, unknown>) => {
        if (rows.some((r) => r.eventId === v.eventId)) {
          return Promise.reject(new Error('UNIQUE constraint failed: webhook_outbox.event_id'))
        }
        rows.push(v)
        return Promise.resolve(undefined)
      }),
    }),
  }
}

function createSelectMock(resultRows: unknown[]) {
  const chain = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    all: vi.fn().mockResolvedValue(resultRows),
  }
  chain.where.mockImplementation(() => chain)
  chain.orderBy.mockImplementation(() => chain)
  chain.limit.mockImplementation(() => chain)
  const db = { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(chain) }) }
  return { db, chain }
}

function createUpdateMock() {
  const where = vi.fn().mockResolvedValue(undefined)
  const set = vi.fn().mockImplementation(() => ({ where }))
  const db = { update: vi.fn().mockReturnValue({ set }) }
  return { db, set, where }
}
