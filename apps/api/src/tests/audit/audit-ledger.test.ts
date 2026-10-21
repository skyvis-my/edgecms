import { describe, expect, it } from 'bun:test'
import {
  AUDIT_GENESIS_HASH,
  AUDIT_PSEUDONYM_PREFIX,
  canonicalJson,
  redactAuditMetadata,
  verifyAuditChain,
} from '@/audit/audit-chain'
import {
  AUDIT_RETENTION_CHECK_INTERVAL,
  MIN_AUDIT_RETENTION_DAYS,
  auditService,
  resolveAuditRetentionDays,
} from '@/audit/audit.service'
import { auditRepository } from '@/audit/audit.repository'
import { createAuditTestDb } from './audit-test-db'

const DAY = 86_400_000

async function seedChain(db: ReturnType<typeof createAuditTestDb>['db'], scope: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    await auditService.append(db, {
      scope,
      category: 'command',
      action: 'command.executed',
      outcome: 'success',
      actorId: 'user-1',
      actorSource: 'user',
      targetType: 'command',
      targetId: `cmd-${i}`,
      metadata: { commandType: 'updateEntry', entryId: `e-${i}` },
    })
  }
  return auditRepository.listPage(db, scope, 0, 1000)
}

describe('audit chain primitives', () => {
  it('canonicalizes objects with sorted keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}'
    )
  })

  it('redacts secret-looking keys recursively, including emails', () => {
    expect(
      redactAuditMetadata({
        apiKey: 'k',
        nested: { password: 'p', refresh_token: 't', email: 'a@b.c', keep: 'ok' },
        list: [{ secret: 's' }],
      })
    ).toEqual({
      apiKey: '[redacted]',
      nested: { password: '[redacted]', refresh_token: '[redacted]', email: '[redacted]', keep: 'ok' },
      list: [{ secret: '[redacted]' }],
    })
  })

  it('clamps retention below one year to the 365-day minimum', () => {
    expect(resolveAuditRetentionDays(undefined)).toBe(MIN_AUDIT_RETENTION_DAYS)
    expect(resolveAuditRetentionDays('30')).toBe(365)
    expect(resolveAuditRetentionDays('not-a-number')).toBe(365)
    expect(resolveAuditRetentionDays('730')).toBe(730)
  })
})

describe('auditService against real SQLite', () => {
  it('links events per scope from the genesis hash and verifies', async () => {
    const { db } = createAuditTestDb()
    const events = await seedChain(db, 'tenant-a', 3)
    await seedChain(db, 'tenant-b', 2)

    expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(events[0]!.prevHash).toBe(AUDIT_GENESIS_HASH)
    expect(events[1]!.prevHash).toBe(events[0]!.hash)
    expect((await auditService.verify(db, 'tenant-a')).valid).toBe(true)
    expect((await auditService.verify(db, 'tenant-b')).headSeq).toBe(2)
  })

  it('keeps seq contiguous under concurrent appends to one scope', async () => {
    const { db } = createAuditTestDb()
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        auditService.append(db, {
          scope: 'tenant-a',
          category: 'rbac',
          action: 'admin.roles.post',
          outcome: 'success',
          actorSource: 'user',
          metadata: { i },
        })
      )
    )
    const events = await auditRepository.listPage(db, 'tenant-a', 0, 100)
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect((await auditService.verify(db, 'tenant-a')).valid).toBe(true)
  })

  it('detects an edited event', async () => {
    const { db, sqlite } = createAuditTestDb()
    await seedChain(db, 'tenant-a', 4)
    sqlite.run(
      `UPDATE audit_events SET metadata = '{"commandType":"deleteEntry"}' WHERE scope = 'tenant-a' AND seq = 2`
    )
    const result = await auditService.verify(db, 'tenant-a')
    expect(result.valid).toBe(false)
    expect(result.failure).toEqual({ seq: 2, reason: 'hash_mismatch' })
  })

  it('detects a deleted event in the middle of the chain', async () => {
    const { db, sqlite } = createAuditTestDb()
    await seedChain(db, 'tenant-a', 4)
    sqlite.run(`DELETE FROM audit_events WHERE scope = 'tenant-a' AND seq = 3`)
    expect((await auditService.verify(db, 'tenant-a')).failure).toEqual({ seq: 4, reason: 'seq_gap' })
  })

  it('detects a swapped actor that is not a pseudonym', async () => {
    const { db, sqlite } = createAuditTestDb()
    await seedChain(db, 'tenant-a', 2)
    sqlite.run(`UPDATE audit_events SET actorId = 'someone-else' WHERE seq = 1`)
    expect((await auditService.verify(db, 'tenant-a')).failure?.reason).toBe('actor_digest_mismatch')
  })

  it('stays valid after an actor is pseudonymized', async () => {
    const { db, sqlite } = createAuditTestDb()
    await seedChain(db, 'tenant-a', 3)
    sqlite.run(`UPDATE audit_events SET actorId = '${AUDIT_PSEUDONYM_PREFIX}abc' WHERE actorId = 'user-1'`)
    expect((await auditService.verify(db, 'tenant-a')).valid).toBe(true)
  })

  it('detects removal of the oldest events without a prune record', async () => {
    const { db, sqlite } = createAuditTestDb()
    await seedChain(db, 'tenant-a', 4)
    sqlite.run(`DELETE FROM audit_events WHERE scope = 'tenant-a' AND seq <= 2`)
    expect((await auditService.verify(db, 'tenant-a')).failure).toEqual({
      seq: 3,
      reason: 'missing_prune_record',
    })
  })

  it('prunes past retention with an in-chain record that keeps the chain verifiable', async () => {
    const { db } = createAuditTestDb()
    const start = Date.parse('2024-01-01T00:00:00.000Z')
    for (let i = 0; i < 5; i += 1) {
      await auditService.append(
        db,
        { scope: 'tenant-a', category: 'auth', action: 'x', outcome: 'success', actorSource: 'system' },
        { now: () => new Date(start + i * 30 * DAY) }
      )
    }
    // 400 days after the first event: events 1-2 (day 0, 30) are past 365 days.
    const pruned = await auditService.enforceRetention(db, 'tenant-a', {
      now: () => new Date(start + 400 * DAY),
    })
    expect(pruned).toEqual({ prunedThroughSeq: 2 })

    const remaining = await auditRepository.listPage(db, 'tenant-a', 0, 100)
    expect(remaining.map((e) => e.seq)).toEqual([3, 4, 5, 6])
    expect(remaining[remaining.length - 1]!.action).toBe('audit.retention_pruned')
    const verification = await auditService.verify(db, 'tenant-a')
    expect(verification).toMatchObject({ valid: true, firstSeq: 3, headSeq: 6 })
  })

  it('never prunes inside the retention window, even if a shorter value is configured', async () => {
    const { db } = createAuditTestDb()
    const now = Date.parse('2026-01-01T00:00:00.000Z')
    await auditService.append(
      db,
      { scope: 'tenant-a', category: 'auth', action: 'x', outcome: 'success', actorSource: 'system' },
      { now: () => new Date(now - 300 * DAY) }
    )
    const pruned = await auditService.enforceRetention(db, 'tenant-a', {
      retentionDays: 30,
      now: () => new Date(now),
    })
    expect(pruned).toBeNull()
    expect(await auditRepository.listPage(db, 'tenant-a', 0, 10)).toHaveLength(1)
  })

  it('runs retention automatically on every Nth append', async () => {
    const { db } = createAuditTestDb()
    const old = Date.parse('2020-01-01T00:00:00.000Z')
    await auditService.append(
      db,
      { scope: 'tenant-a', category: 'auth', action: 'old', outcome: 'success', actorSource: 'system' },
      { now: () => new Date(old) }
    )
    for (let i = 1; i < AUDIT_RETENTION_CHECK_INTERVAL; i += 1) {
      await auditService.append(db, {
        scope: 'tenant-a',
        category: 'auth',
        action: 'new',
        outcome: 'success',
        actorSource: 'system',
      })
    }
    const first = await auditRepository.listPage(db, 'tenant-a', 0, 1)
    expect(first[0]!.seq).toBe(2)
    expect((await auditService.verify(db, 'tenant-a')).valid).toBe(true)
  })

  it('verifyAuditChain rejects events from another scope', async () => {
    const { db } = createAuditTestDb()
    const events = await seedChain(db, 'tenant-a', 1)
    expect((await verifyAuditChain('tenant-b', events)).failure?.reason).toBe('scope_mismatch')
  })
})
