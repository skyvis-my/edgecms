import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
import type { CommandContext } from '@/commands/engine'
import { createSqliteD1 } from '../helpers/sqlite-d1'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { createDb } = await import('@/database/db')
const { executeCommand } = await import('@/commands/engine')

/**
 * CMD-03 / CMD-04: a single (non-transaction) dry-run never reserves, stores
 * or replays an idempotency record and never writes `processed_commands`, so
 * the real execution that follows with the same key still runs. Real
 * executions keep at-most-once duplicate suppression. Runs the real engine,
 * handlers and diff service against SQLite with every migration applied.
 */

const TENANT = 't-acme'
const KEY = 'single-key-1'
const actor = { userId: 'u1', source: 'admin' as const }
const at = () => new Date().toISOString()

function createKv() {
  const store = new Map<string, string>()
  const kv = {
    get: async (key: string, type?: string) => {
      const value = store.get(key)
      if (value === undefined) return null
      return type === 'json' ? JSON.parse(value) : value
    },
    put: async (key: string, value: string) => {
      store.set(key, value)
    },
    delete: async (key: string) => {
      store.delete(key)
    },
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
  }
  return kv as unknown as KVNamespace
}

function setup() {
  const { d1, sqlite } = createSqliteD1()
  const now = at()
  sqlite.exec(`
    INSERT INTO tenants (id, slug, name, status, createdAt, updatedAt, localeCatalog, mediaUploadMaxBytes, mediaUploadMaxDimension, mediaAllowedMimeTypes, aiEnabled, requireMfa)
    VALUES ('${TENANT}', 'acme', 'Acme', 'active', '${now}', '${now}', '[]', 1000000, 4000, '[]', 1, 0);
    INSERT INTO collections (id, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt, tenantId)
    VALUES ('c1', 'Posts', 'posts', 0, '[{"name":"title","type":"text"}]', 'en', '["en"]', '${now}', '${now}', '${TENANT}');
  `)
  const ctx: CommandContext = {
    db: createDb(d1),
    kv: createKv(),
    actor,
    tenantScope: TENANT,
    syncChannel: TENANT,
    idempotencyKey: KEY,
  }
  const count = (table: string) =>
    (sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  const processed = () =>
    sqlite.query(`SELECT id, status FROM processed_commands ORDER BY id`).all() as Array<{
      id: string
      status: string
    }>
  return { sqlite, ctx, count, processed }
}

function createEntry(extra: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    type: 'createEntry',
    payload: { collectionId: 'c1', slug: 'first', data: { title: 'First' } },
    actor,
    timestamp: at(),
    idempotencyKey: KEY,
    ...extra,
  }
}

describe('CMD-03 single-command dry-run with an idempotency key', () => {
  let env: ReturnType<typeof setup>

  beforeEach(() => {
    env = setup()
  })

  it('writes no processed_commands row (no reservation, no stored preview)', async () => {
    const preview = await executeCommand({ ...env.ctx }, createEntry({ dryRun: true }))

    expect(preview.status).toBe('dry_run')
    expect(preview.diff?.length ?? 0).toBeGreaterThan(0)
    expect(env.processed()).toEqual([])
    expect(env.count('entries')).toBe(0)
  })

  it('does not burn the key: the real execution with the same key runs', async () => {
    await executeCommand({ ...env.ctx }, createEntry({ dryRun: true }))

    const executed = await executeCommand({ ...env.ctx }, createEntry())

    expect(executed.status).toBe('success')
    expect(executed.diff).toBeUndefined()
    expect(executed.commandId).toBe(`idem_${KEY}`)
    expect(env.count('entries')).toBe(1)
    expect(env.processed()).toEqual([{ id: `idem_${KEY}`, status: 'success' }])
  })

  it('a dry-run after a real execution does not replay or alter the stored record', async () => {
    const executed = await executeCommand({ ...env.ctx }, createEntry())
    expect(executed.status).toBe('success')

    const preview = await executeCommand({ ...env.ctx }, createEntry({ dryRun: true }))

    expect(preview.status).toBe('dry_run')
    expect(preview.commandId).not.toBe(`idem_${KEY}`)
    expect(env.processed()).toEqual([{ id: `idem_${KEY}`, status: 'success' }])
    expect(env.count('entries')).toBe(1)
  })

  it('keeps CMD-04 at-most-once for real executions after a keyed dry-run', async () => {
    await executeCommand({ ...env.ctx }, createEntry({ dryRun: true }))
    const first = await executeCommand({ ...env.ctx }, createEntry())
    const replay = await executeCommand({ ...env.ctx }, createEntry())

    expect(first.status).toBe('success')
    expect(replay.status).toBe('success')
    expect(replay.commandId).toBe(first.commandId)
    expect(replay.data).toEqual(first.data)
    expect(env.count('entries')).toBe(1)
  })

  it('AI-05: the receipt from a keyed dry-run redeems exactly once', async () => {
    const preview = await executeCommand({ ...env.ctx }, createEntry({ dryRun: true }))
    expect(preview.previewReceipt).toEqual(expect.stringMatching(/^rcpt_/))

    const executed = await executeCommand(
      { ...env.ctx },
      createEntry({ previewReceipt: preview.previewReceipt })
    )
    expect(executed.status).toBe('success')
    expect(env.count('entries')).toBe(1)

    // Same receipt under a fresh key: the receipt is already spent.
    const reused = await executeCommand(
      { ...env.ctx, idempotencyKey: 'other-key' },
      createEntry({ idempotencyKey: 'other-key', previewReceipt: preview.previewReceipt })
    )
    expect(reused.status).toBe('failed')
    expect(reused.error?.code).toBe('INVALID_PREVIEW_RECEIPT')
    expect(env.count('entries')).toBe(1)
  })

  it('a legacy stored dry_run row does not replay: the real execution claims the key once', async () => {
    // Rows written before this fix stored keyed previews as status 'dry_run'.
    env.sqlite.exec(`
      INSERT INTO processed_commands (id, commandType, payload, actor, result, status, tenantScope, executedAt)
      VALUES ('idem_${KEY}', 'createEntry', '{"collectionId":"c1"}', '{"userId":"u1","source":"admin"}',
        '{"diff":[],"previewReceipt":"rcpt_legacy"}', 'dry_run', '${TENANT}', '${at()}');
    `)

    const executed = await executeCommand({ ...env.ctx }, createEntry())
    const replay = await executeCommand({ ...env.ctx }, createEntry())

    expect(executed.status).toBe('success')
    expect(replay.status).toBe('success')
    expect(replay.data).toEqual(executed.data)
    expect(env.count('entries')).toBe(1)
    expect(env.processed()).toEqual([{ id: `idem_${KEY}`, status: 'success' }])
  })
})
