import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
import type { CommandContext } from '@/commands/engine'
import { createSqliteD1 } from '../helpers/sqlite-d1'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { createDb } = await import('@/database/db')
const { executeCommand, IDEMPOTENCY_PENDING_LEASE_MS } = await import('@/commands/engine')

/**
 * CMD-04: a replayed envelope executes at most once, including when two
 * first requests with the same key arrive together. The `pending`
 * reservation is an atomic insert-or-fail; a stale reservation left by a
 * crashed request is taken over after a bounded lease. Real engine, real
 * handlers, SQLite with every migration applied.
 */

const TENANT = 't-acme'
const KEY = 'race-key-1'
const actor = { userId: 'u1', source: 'admin' as const }
const at = () => new Date().toISOString()

function createKv() {
  const store = new Map<string, string>()
  return {
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
  } as unknown as KVNamespace
}

type Stmt = {
  bind: (...params: unknown[]) => Stmt
  all: () => Promise<unknown>
  raw: () => Promise<unknown>
  first: (column?: string) => Promise<unknown>
  run: () => Promise<unknown>
}

/**
 * Adds a network-like round trip to every statement so two in-flight
 * requests interleave the way they do against remote D1: both read
 * `processed_commands` before either writes.
 */
function withLatency(inner: D1Database): D1Database {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 2))
  const wrap = (stmt: Stmt): Stmt & { inner: Stmt } => ({
    inner: stmt,
    bind: (...params) => wrap(stmt.bind(...params)),
    all: async () => (await tick(), stmt.all()),
    raw: async () => (await tick(), stmt.raw()),
    first: async (column) => (await tick(), stmt.first(column)),
    run: async () => (await tick(), stmt.run()),
  })
  const d1 = inner as unknown as {
    prepare: (sql: string) => Stmt
    batch: (s: Stmt[]) => Promise<unknown>
    exec: (sql: string) => Promise<unknown>
  }
  return {
    prepare: (sql: string) => wrap(d1.prepare(sql)),
    batch: async (statements: Array<{ inner: Stmt }>) => {
      await tick()
      return d1.batch(statements.map((s) => s.inner))
    },
    exec: (sql: string) => d1.exec(sql),
  } as unknown as D1Database
}

function setup() {
  const { d1: raw, sqlite } = createSqliteD1()
  const d1 = withLatency(raw)
  const now = at()
  sqlite.exec(`
    INSERT INTO tenants (id, slug, name, status, createdAt, updatedAt, localeCatalog, mediaUploadMaxBytes, mediaUploadMaxDimension, mediaAllowedMimeTypes, aiEnabled, requireMfa)
    VALUES ('${TENANT}', 'acme', 'Acme', 'active', '${now}', '${now}', '[]', 1000000, 4000, '[]', 1, 0);
    INSERT INTO collections (id, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt, tenantId)
    VALUES ('c1', 'Posts', 'posts', 0, '[{"name":"title","type":"text"}]', 'en', '["en"]', '${now}', '${now}', '${TENANT}');
  `)
  // Each request gets its own Drizzle client over the same database, like two isolates.
  const ctx = (): CommandContext => ({
    db: createDb(d1, { sessionToken: crypto.randomUUID() }),
    kv: createKv(),
    actor,
    tenantScope: TENANT,
    syncChannel: TENANT,
    idempotencyKey: KEY,
  })
  const count = (table: string) =>
    (sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  const processed = () =>
    sqlite.query(`SELECT id, status FROM processed_commands ORDER BY id`).all() as Array<{
      id: string
      status: string
    }>
  return { sqlite, ctx, count, processed }
}

function createEntry(slug = 'first'): CommandEnvelope {
  return {
    type: 'createEntry',
    payload: { collectionId: 'c1', slug, data: { title: 'First' } },
    actor,
    timestamp: at(),
    idempotencyKey: KEY,
  }
}

function transaction(): CommandEnvelope {
  return {
    type: 'transaction',
    payload: {
      commands: [
        {
          type: 'createEntry',
          payload: { collectionId: 'c1', slug: 'tx-a', data: { title: 'A' } },
          actor,
          timestamp: at(),
        },
        {
          type: 'createEntry',
          payload: { collectionId: 'c1', slug: 'tx-b', data: { title: 'B' } },
          actor,
          timestamp: at(),
        },
      ],
    },
    actor,
    timestamp: at(),
    idempotencyKey: KEY,
  }
}

/** Exactly one result executed; the other replayed it or got a typed in-progress error. */
function expectOneExecution(results: Awaited<ReturnType<typeof executeCommand>>[]) {
  const executed = results.filter((r) => r.status === 'success')
  const blocked = results.filter((r) => r.status !== 'success')
  for (const r of blocked) {
    expect(r.error?.code).toBe('CONCURRENT_REQUEST')
  }
  expect(executed.length).toBeGreaterThanOrEqual(1)
  // A second success is allowed only as a replay of the same stored result.
  for (const r of executed) {
    expect(r.commandId).toBe(`idem_${KEY}`)
    expect(r.data).toEqual(executed[0].data)
  }
}

describe('CMD-04 concurrent first requests with the same idempotency key', () => {
  let env: ReturnType<typeof setup>

  beforeEach(() => {
    env = setup()
  })

  it('two simultaneous createEntry calls create exactly one entry', async () => {
    const results = await Promise.all([
      executeCommand(env.ctx(), createEntry()),
      executeCommand(env.ctx(), createEntry()),
    ])

    expectOneExecution(results)
    expect(env.count('entries')).toBe(1)
    expect(env.count('audit_log')).toBe(1)
    expect(env.processed()).toEqual([{ id: `idem_${KEY}`, status: 'success' }])
  })

  it('two simultaneous updateEntry calls apply the update once', async () => {
    // No unique index masks a double run here: a second execution would bump the version again.
    const now = at()
    env.sqlite.exec(`
      INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
      VALUES ('e1', 'c1', 'seed', 'draft', '{"title":"Seed"}', 1, '${now}', '${now}');
    `)
    const update = (): CommandEnvelope => ({
      type: 'updateEntry',
      payload: { entryId: 'e1', data: { title: 'Updated' } },
      actor,
      timestamp: at(),
      idempotencyKey: KEY,
    })

    const results = await Promise.all([
      executeCommand(env.ctx(), update()),
      executeCommand(env.ctx(), update()),
    ])

    expectOneExecution(results)
    const row = env.sqlite.query(`SELECT version FROM entries WHERE id = 'e1'`).get() as {
      version: number
    }
    expect(row.version).toBe(2)
    expect(env.count('audit_log')).toBe(1)
  })

  it('five simultaneous calls still create exactly one entry', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => executeCommand(env.ctx(), createEntry()))
    )

    expectOneExecution(results)
    expect(env.count('entries')).toBe(1)
  })

  it('two simultaneous transactions run their sub-commands once', async () => {
    const results = await Promise.all([
      executeCommand(env.ctx(), transaction()),
      executeCommand(env.ctx(), transaction()),
    ])

    expectOneExecution(results)
    expect(env.count('entries')).toBe(2)
    expect(env.processed().filter((r) => r.id === `idem_${KEY}`)).toEqual([
      { id: `idem_${KEY}`, status: 'success' },
    ])
  })

  it('a fresh pending reservation blocks a retry with CONCURRENT_REQUEST', async () => {
    env.sqlite.exec(`
      INSERT INTO processed_commands (id, commandType, payload, actor, result, status, tenantScope, executedAt)
      VALUES ('idem_${KEY}', 'createEntry', '${JSON.stringify(createEntry().payload)}',
        '{"userId":"u1","source":"admin"}', NULL, 'pending', '${TENANT}', '${at()}');
    `)

    const retry = await executeCommand(env.ctx(), createEntry())

    expect(retry.status).toBe('failed')
    expect(retry.error?.code).toBe('CONCURRENT_REQUEST')
    expect(env.count('entries')).toBe(0)
  })

  it('a stale pending reservation from a crashed request is taken over once', async () => {
    const stale = new Date(Date.now() - IDEMPOTENCY_PENDING_LEASE_MS - 1000).toISOString()
    env.sqlite.exec(`
      INSERT INTO processed_commands (id, commandType, payload, actor, result, status, tenantScope, executedAt)
      VALUES ('idem_${KEY}', 'createEntry', '${JSON.stringify(createEntry().payload)}',
        '{"userId":"u1","source":"admin"}', NULL, 'pending', '${TENANT}', '${stale}');
    `)

    const results = await Promise.all([
      executeCommand(env.ctx(), createEntry()),
      executeCommand(env.ctx(), createEntry()),
    ])

    expectOneExecution(results)
    expect(results.some((r) => r.status === 'success')).toBe(true)
    expect(env.count('entries')).toBe(1)
    expect(env.processed()).toEqual([{ id: `idem_${KEY}`, status: 'success' }])
  })

  it('a stale pending reservation with a different payload still conflicts', async () => {
    const stale = new Date(Date.now() - IDEMPOTENCY_PENDING_LEASE_MS - 1000).toISOString()
    env.sqlite.exec(`
      INSERT INTO processed_commands (id, commandType, payload, actor, result, status, tenantScope, executedAt)
      VALUES ('idem_${KEY}', 'createEntry', '{"collectionId":"c1","slug":"other"}',
        '{"userId":"u1","source":"admin"}', NULL, 'pending', '${TENANT}', '${stale}');
    `)

    const result = await executeCommand(env.ctx(), createEntry())

    expect(result.error?.code).toBe('IDEMPOTENCY_CONFLICT')
    expect(env.count('entries')).toBe(0)
  })
})
