import { describe, expect, it } from 'bun:test'
import { AUDIT_PSEUDONYM_PREFIX } from '@/audit/audit-chain'
import { auditService } from '@/audit/audit.service'
import { privacyService } from '@/privacy/privacy.service'
import { createPrivacyFixture } from './privacy-test-seed'

const self = { kind: 'self' as const, actorId: 'alice' }

describe('privacyService.exportUserData', () => {
  it('exports account, sessions, memberships and authored references without secrets', async () => {
    const { db } = await createPrivacyFixture()
    const result = await privacyService.exportUserData(db, 'alice', self)
    expect(result.success).toBe(true)
    if (!result.success) return

    const data = result.data
    expect(data.user).toMatchObject({ id: 'alice', email: 'alice@example.com', name: 'Alice Example' })
    expect(data.accounts.map((a) => a.providerId).sort()).toEqual(['credential', 'google'])
    expect(data.sessions).toHaveLength(1)
    expect(data.sessions[0]).toMatchObject({ id: 's1', ipAddress: '203.0.113.7' })
    expect(data.memberships.map((m) => [m.tenantSlug, m.role]).sort()).toEqual([
      ['one', 'owner'],
      ['two', 'member'],
    ])
    expect(data.authoredReferences.entryVersions.items).toEqual([
      { entryId: 'e1', version: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    expect(data.authoredReferences.assets.items.map((a) => a.id)).toEqual(['a1'])
    expect(data.authoredReferences.aiImportBatches.items.map((b) => b.id)).toEqual(['b1'])
    expect(data.authoredReferences.commands.items.map((c) => c.id)).toEqual(['cmd1'])
    expect(data.auditEvents.items.map((e) => e.action).sort()).toEqual([
      'admin.tenants.put',
      'command.executed',
    ])

    const serialized = JSON.stringify(data)
    for (const secret of [
      'hashed-password',
      'oauth-access-token',
      'oauth-refresh-token',
      'secret-session-token',
      'verify-token',
      'bob-session-token',
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('records the export in the global audit chain', async () => {
    const { db } = await createPrivacyFixture()
    await privacyService.exportUserData(db, 'alice', self)
    const page = await auditService.exportPage(db, 'global', 0, 10)
    expect(page.events[page.events.length - 1]).toMatchObject({
      category: 'privacy',
      action: 'privacy.data_exported',
      targetId: 'alice',
    })
  })

  it('returns NOT_FOUND for an unknown user', async () => {
    const { db } = await createPrivacyFixture()
    const result = await privacyService.exportUserData(db, 'nobody', self)
    expect(result).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } })
  })
})

describe('privacyService.deleteUserData', () => {
  it('deletes account data, pseudonymizes references and keeps content and chains intact', async () => {
    const { db, sqlite } = await createPrivacyFixture()
    const result = await privacyService.deleteUserData(db, 'alice', self)
    expect(result.success).toBe(true)
    if (!result.success) return
    const { pseudonym } = result.data
    expect(pseudonym.startsWith(AUDIT_PSEUDONYM_PREFIX)).toBe(true)

    const count = (q: string) => (sqlite.query(q).get() as { n: number }).n
    expect(count(`SELECT COUNT(*) n FROM user WHERE id = 'alice'`)).toBe(0)
    expect(count(`SELECT COUNT(*) n FROM session WHERE userId = 'alice'`)).toBe(0)
    expect(count(`SELECT COUNT(*) n FROM account WHERE userId = 'alice'`)).toBe(0)
    expect(count(`SELECT COUNT(*) n FROM tenant_users WHERE userId = 'alice'`)).toBe(0)
    expect(count(`SELECT COUNT(*) n FROM verification`)).toBe(0)

    // Other users and all tenant content stay.
    expect(count(`SELECT COUNT(*) n FROM user`)).toBe(2)
    expect(count(`SELECT COUNT(*) n FROM session WHERE userId = 'bob'`)).toBe(1)
    expect(count(`SELECT COUNT(*) n FROM entries`)).toBe(1)
    expect(count(`SELECT COUNT(*) n FROM entry_versions`)).toBe(2)
    expect(count(`SELECT COUNT(*) n FROM assets`)).toBe(1)
    expect(sqlite.query(`SELECT data FROM entries WHERE id = 'e1'`).get()).toEqual({
      data: '{"title":"Hello by Alice"}',
    })

    expect(sqlite.query(`SELECT createdBy FROM entry_versions ORDER BY version`).all()).toEqual([
      { createdBy: pseudonym },
      { createdBy: 'bob' },
    ])
    expect(sqlite.query(`SELECT created_by FROM assets`).get()).toEqual({ created_by: pseudonym })
    expect(sqlite.query(`SELECT created_by_user_id u FROM ai_import_batches`).get()).toEqual({
      u: pseudonym,
    })
    expect(
      sqlite.query(`SELECT json_extract(actor, '$.userId') u FROM processed_commands ORDER BY id`).all()
    ).toEqual([{ u: pseudonym }, { u: 'bob' }])
    expect(
      count(`SELECT COUNT(*) n FROM audit_events WHERE actorId = 'alice' OR targetId = 'alice'`)
    ).toBe(0)

    expect((await auditService.verify(db, 't1')).valid).toBe(true)
    expect((await auditService.verify(db, 'global')).valid).toBe(true)

    expect(result.data.pseudonymized).toMatchObject({
      entryVersions: 1,
      assets: 1,
      aiImportBatches: 1,
      commands: 1,
      auditActor: 1,
      auditTarget: 1,
    })
    expect(result.data.deleted).toEqual({
      sessions: 1,
      accounts: 2,
      memberships: 2,
      verifications: 1,
      user: 1,
    })
    expect(result.data.receipt).toMatchObject({ scope: 'global' })
    const receipt = sqlite
      .query(`SELECT action, actorId, targetId, metadata FROM audit_events WHERE id = ?`)
      .get(result.data.receipt!.auditEventId) as Record<string, string>
    expect(receipt).toMatchObject({ action: 'privacy.user_deleted', actorId: pseudonym, targetId: pseudonym })
    expect(receipt.metadata).not.toContain('alice')
  })

  it('records a super-admin as the actor of a deletion they run', async () => {
    const { db, sqlite } = await createPrivacyFixture()
    const result = await privacyService.deleteUserData(db, 'alice', {
      kind: 'super_admin',
      actorId: 'root',
    })
    if (!result.success) throw new Error('expected success')
    const receipt = sqlite
      .query(`SELECT actorId, metadata FROM audit_events WHERE id = ?`)
      .get(result.data.receipt!.auditEventId) as { actorId: string; metadata: string }
    expect(receipt.actorId).toBe('root')
    expect(JSON.parse(receipt.metadata).requestedBy).toBe('super_admin')
  })

  it('refuses to delete the only owner of a tenant and changes nothing', async () => {
    const { db, sqlite } = await createPrivacyFixture()
    const result = await privacyService.deleteUserData(db, 'carol', {
      kind: 'self',
      actorId: 'carol',
    })
    expect(result).toMatchObject({ success: false, error: { code: 'CONFLICT' } })
    expect(sqlite.query(`SELECT COUNT(*) n FROM user WHERE id = 'carol'`).get()).toEqual({ n: 1 })
  })
})
