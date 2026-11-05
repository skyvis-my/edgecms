import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
import type { CommandContext } from '@/commands/engine'
import { createSqliteD1 } from '../helpers/sqlite-d1'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { createDb } = await import('@/database/db')
const { executeCommand } = await import('@/commands/engine')
const { handleMcpToolCall } = await import('@/mcp/mcp-server')

/**
 * CMD-03: a `transaction` envelope with top-level `dryRun: true` must not
 * write anything. Runs the real engine, handlers and diff service against
 * SQLite with every migration applied.
 */

const TENANT = 't-acme'
const WRITE_TABLES = [
  'entries',
  'entry_versions',
  'audit_log',
  'audit_events',
  'webhook_outbox',
  'change_log',
  'schedule_intents',
  'relations',
] as const

function createKv() {
  const store = new Map<string, string>()
  const deleted: string[] = []
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
      deleted.push(key)
      store.delete(key)
    },
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
  }
  return { kv: kv as unknown as KVNamespace, deleted }
}

function setup() {
  const { d1, sqlite } = createSqliteD1()
  const now = new Date().toISOString()
  sqlite.exec(`
    INSERT INTO tenants (id, slug, name, status, createdAt, updatedAt, localeCatalog, mediaUploadMaxBytes, mediaUploadMaxDimension, mediaAllowedMimeTypes, aiEnabled, requireMfa)
    VALUES ('${TENANT}', 'acme', 'Acme', 'active', '${now}', '${now}', '[]', 1000000, 4000, '[]', 1, 0);
    INSERT INTO collections (id, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt, tenantId)
    VALUES ('c1', 'Posts', 'posts', 0, '[{"name":"title","type":"text"}]', 'en', '["en"]', '${now}', '${now}', '${TENANT}');
    INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
    VALUES ('e1', 'c1', 'hello', 'draft', '{"title":"Hello"}', 1, '${now}', '${now}');
  `)
  const { kv, deleted } = createKv()
  const db = createDb(d1)
  const ctx: CommandContext = {
    db,
    kv,
    actor: { userId: 'u1', source: 'admin' },
    tenantScope: TENANT,
    syncChannel: TENANT,
    idempotencyKey: 'tx-key-1',
  }
  const count = (table: string) =>
    (sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  const snapshot = () => Object.fromEntries(WRITE_TABLES.map((t) => [t, count(t)]))
  return { sqlite, ctx, deleted, count, snapshot }
}

const actor = { userId: 'u1', source: 'admin' as const }
const at = () => new Date().toISOString()

function subCommands(): CommandEnvelope[] {
  return [
    {
      type: 'createEntry',
      payload: { collectionId: 'c1', slug: 'second', data: { title: 'Second' } },
      actor,
      timestamp: at(),
    },
    {
      type: 'updateEntry',
      payload: { entryId: 'e1', data: { title: 'Changed' } },
      optimisticVersion: 1,
      actor,
      timestamp: at(),
    },
    { type: 'publishNow', payload: { entryId: 'e1' }, actor, timestamp: at() },
  ]
}

function transaction(extra: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    type: 'transaction',
    payload: { commands: subCommands() },
    actor,
    timestamp: at(),
    ...extra,
  }
}

describe('CMD-03 transaction dry-run', () => {
  let env: ReturnType<typeof setup>

  beforeEach(() => {
    env = setup()
  })

  it('writes nothing and returns the combined diff of every sub-command', async () => {
    const before = env.snapshot()
    const ctx = { ...env.ctx }

    const result = await executeCommand(ctx, transaction({ dryRun: true }))

    expect(result.status).toBe('dry_run')
    const subResults = (result.data?.subResults ?? []) as Array<{
      status: string
      diff?: unknown[]
    }>
    expect(subResults).toHaveLength(3)
    for (const sub of subResults) expect(sub.status).toBe('dry_run')

    // Combined diff: every sub-command's diff, attributed to its index and type.
    const combined = (result.diff ?? []) as Array<Record<string, unknown>>
    const expectedLength = subResults.reduce((n, sub) => n + (sub.diff?.length ?? 0), 0)
    expect(expectedLength).toBeGreaterThan(0)
    expect(combined).toHaveLength(expectedLength)
    expect(combined).toContainEqual(
      expect.objectContaining({ commandIndex: 1, commandType: 'updateEntry', field: 'title' })
    )
    expect(new Set(combined.map((d) => d.commandIndex))).toEqual(new Set([0, 1, 2]))

    // Nothing written: entries, versions, audit, outbox intents, change log.
    expect(env.snapshot()).toEqual(before)
    expect(
      env.sqlite.query(`SELECT status, data, version FROM entries WHERE id = 'e1'`).get()
    ).toEqual({ status: 'draft', data: '{"title":"Hello"}', version: 1 })

    // No execution or duplicate-suppression records.
    expect(env.count('processed_commands')).toBe(0)

    // No cache purge.
    expect(env.deleted).toEqual([])
    expect(ctx.invalidatedCacheTags ?? []).toEqual([])
  })

  it('does not burn the idempotency key: a later real execution with the same key runs', async () => {
    await executeCommand({ ...env.ctx }, transaction({ dryRun: true }))

    const executed = await executeCommand({ ...env.ctx }, transaction())

    expect(executed.status).toBe('success')
    expect(env.count('entries')).toBe(2)
    expect(
      env.sqlite.query(`SELECT status FROM entries WHERE id = 'e1'`).get()
    ).toEqual({ status: 'published' })
  })

  it('issues one preview receipt for the whole transaction that authorises its execution', async () => {
    const commands = subCommands()
    const preview = await executeCommand(
      { ...env.ctx, idempotencyKey: undefined },
      { type: 'transaction', payload: { commands }, actor, timestamp: at(), dryRun: true }
    )
    expect(preview.status).toBe('dry_run')
    expect(preview.previewReceipt).toEqual(expect.stringMatching(/^rcpt_/))

    const executed = await executeCommand(
      { ...env.ctx, idempotencyKey: undefined },
      {
        type: 'transaction',
        payload: { commands },
        actor,
        timestamp: at(),
        previewReceipt: preview.previewReceipt,
      }
    )
    expect(executed.status).toBe('success')
    expect(env.count('entries')).toBe(2)
  })

  it('a failing dry-run sub-command stops the preview and still writes nothing', async () => {
    const before = env.snapshot()
    // Reads fail (as a D1 outage would) so the updateEntry diff cannot be computed.
    const db = new Proxy(env.ctx.db, {
      get: (target, prop, receiver) =>
        prop === 'select'
          ? () => {
              throw new Error('D1 read failed')
            }
          : Reflect.get(target, prop, receiver),
    })

    const result = await executeCommand({ ...env.ctx, db }, transaction({ dryRun: true }))

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('TRANSACTION_FAILED')
    expect(result.error?.message).toContain('Nothing was written')
    expect(result.previewReceipt).toBeUndefined()
    expect(env.snapshot()).toEqual(before)
    expect(env.count('processed_commands')).toBe(0)
    expect(env.deleted).toEqual([])
  })
})

describe('CMD-03 MCP preview of a transaction uses the same engine path', () => {
  it('previews without writing, returns the combined diff, and its receipt executes', async () => {
    const env = setup()
    const before = env.snapshot()
    const ctx = { ...env.ctx, idempotencyKey: undefined, actor: { userId: 'u1', source: 'ai' as const } }

    const preview = await handleMcpToolCall(ctx, 'edgecms_preview_command', {
      type: 'transaction',
      payload: { commands: subCommands().map((cmd) => ({ ...cmd, actor: ctx.actor })) },
    })
    expect(preview.isError).toBeUndefined()
    const previewBody = JSON.parse(preview.content[0]!.text) as {
      status: string
      diff: Array<Record<string, unknown>>
      previewReceipt: string
    }
    expect(previewBody.status).toBe('dry_run')
    expect(new Set(previewBody.diff.map((d) => d.commandIndex))).toEqual(new Set([0, 1, 2]))
    expect(env.snapshot()).toEqual(before)

    const executed = await handleMcpToolCall(ctx, 'edgecms_execute_command', {
      previewReceipt: previewBody.previewReceipt,
    })
    expect(executed.isError).toBeUndefined()
    expect(env.count('entries')).toBe(2)
    expect(env.sqlite.query(`SELECT status FROM entries WHERE id = 'e1'`).get()).toEqual({
      status: 'published',
    })
  })
})
