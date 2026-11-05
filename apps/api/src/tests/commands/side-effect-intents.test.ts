/**
 * CMD-06: post-commit side effects are durable intents.
 *
 * KV snapshot invalidation, CDN tag purge, frontend revalidation, RAG
 * indexing and FTS sync are written as `side_effect_intents` rows in the same
 * D1 batch as the processed command, run after the commit and marked done.
 * A crash after the commit leaves pending rows that a later relay completes.
 *
 * Real SQL (bun:sqlite with every migration), real engine, handlers,
 * cache-tag extraction, CDN purge and revalidation services. Only the global
 * fetch is replaced.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const sqliteHandle = createSqliteD1()
const { sqlite } = sqliteHandle

const { executeCommand } = await import('@/commands/engine')
const { relaySideEffectIntents, runSideEffectIntents, SIDE_EFFECT_MAX_ATTEMPTS } = await import(
  '@/commands/side-effect-intents'
)
const { createDb } = await import('@/database/db')
const { ftsService } = await import('@/search/fts.service')

const TENANT = 'tenant-a'
const NOW = '2026-01-01T00:00:00.000Z'
const REVALIDATE_URL = 'https://site.example.com/api/revalidate'

const kvStore = new Map<string, string>()
const kv = {
  get: async (key: string, type?: string) => {
    const value = kvStore.get(key)
    if (value === undefined) return null
    return type === 'json' ? JSON.parse(value) : value
  },
  put: async (key: string, value: string) => {
    kvStore.set(key, value)
  },
  delete: async (key: string) => {
    kvStore.delete(key)
  },
  list: async () => ({ keys: [], list_complete: true, cursor: '' }),
} as unknown as KVNamespace

const env = {
  CF_API_TOKEN: 'cf-test-token',
  CLOUDFLARE_ZONE_ID: 'zone-test',
  FRONTEND_REVALIDATE_URL: REVALIDATE_URL,
  FRONTEND_REVALIDATE_SECRET: 'revalidate-test-secret',
} as never

const realFetch = globalThis.fetch
let fetchCalls: string[] = []

/** Every outbound call hangs: the worker dies before purge or revalidation finishes. */
function crashOnFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input))
    return new Promise<Response>(() => {})
  }) as typeof fetch
}

function failOnFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input))
    return new Response('upstream down', { status: 503 })
  }) as typeof fetch
}

function succeedOnFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input))
    return new Response('{}', { status: 200 })
  }) as typeof fetch
}

function seed() {
  sqlite.exec(`
    delete from side_effect_intents; delete from audit_events; delete from change_log;
    delete from webhook_outbox; delete from processed_commands; delete from entry_versions;
    delete from entries_fts; delete from entries; delete from collections; delete from tenants;
  `)
  sqlite
    .query(
      `insert into tenants (id, slug, name, status, localeCatalog, mediaAllowedMimeTypes, createdAt, updatedAt)
       values (?, 'acme', 'Acme', 'active', '["en"]', '["image/png"]', ?, ?)`
    )
    .run(TENANT, NOW, NOW)
  const fields = JSON.stringify([{ name: 'title', type: 'text', required: false }])
  sqlite
    .query(
      `insert into collections (id, tenantId, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt)
       values ('col-blog', ?, 'Blog', 'blog', 0, ?, 'en', '["en"]', ?, ?)`
    )
    .run(TENANT, fields, NOW, NOW)
  sqlite
    .query(
      `insert into entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
       values ('entry-1', 'col-blog', 'hello-world', 'draft', '{"title":"Hello durable world"}', 1, ?, ?)`
    )
    .run(NOW, NOW)
}

function ctx() {
  return {
    db: createDb(sqliteHandle.d1),
    actor: { userId: 'u-1', source: 'admin' },
    tenantScope: TENANT,
    syncChannel: TENANT,
    kv,
    env,
  }
}

function command(type: 'publishNow' | 'unpublishNow' | 'deleteEntry') {
  return {
    type,
    payload: { entryId: 'entry-1' },
    actor: { userId: 'u-1', source: 'admin' as const },
    timestamp: new Date().toISOString(),
  }
}

type IntentRow = {
  kind: string
  status: string
  attempts: number
  command_id: string
  tenant_scope: string
  next_attempt_at: string | null
}

const intents = () =>
  sqlite
    .query(
      `select kind, status, attempts, command_id, tenant_scope, next_attempt_at
       from side_effect_intents order by kind`
    )
    .all() as IntentRow[]

const statusByKind = () => Object.fromEntries(intents().map((row) => [row.kind, row.status]))

/** Let detached post-commit work run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => {
  kvStore.clear()
  fetchCalls = []
  seed()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('CMD-06 durable side-effect intents', () => {
  it('records every intent with the command and marks them done after the commit', async () => {
    succeedOnFetch()
    const result = await executeCommand(ctx(), command('publishNow'))
    expect(result.status).toBe('success')
    await settle()

    const rows = intents()
    expect(rows.map((row) => row.kind)).toEqual([
      'cdn_purge',
      'frontend_revalidate',
      'fts_sync',
      'kv_invalidate',
      'rag_index',
    ])
    for (const row of rows) {
      expect(row.command_id).toBe(result.commandId)
      expect(row.tenant_scope).toBe(TENANT)
      expect(row.status).toBe('done')
    }
    expect(fetchCalls.some((url) => url.includes('/zones/zone-test/purge_cache'))).toBe(true)
    expect(fetchCalls).toContain(REVALIDATE_URL)
    // FTS index now carries the published entry, scoped to its tenant.
    const hits = await ftsService.search(createDb(sqliteHandle.d1), 'durable', TENANT)
    expect(hits.map((hit) => hit.entryId)).toEqual(['entry-1'])
    expect(await ftsService.search(createDb(sqliteHandle.d1), 'durable', 'tenant-b')).toEqual([])
  })

  it('a crash after commit but before purge leaves pending intents that a later relay completes', async () => {
    crashOnFetch()
    const result = await executeCommand(ctx(), command('publishNow'))
    expect(result.status).toBe('success')
    await settle()

    // The mutation is committed; purge and revalidation never finished.
    expect(
      (sqlite.query(`select status from entries where id = 'entry-1'`).get() as { status: string })
        .status
    ).toBe('published')
    const pending = statusByKind()
    expect(pending.cdn_purge).toBe('pending')
    expect(pending.frontend_revalidate).toBe('pending')
    expect(fetchCalls.filter((url) => url.includes('purge_cache'))).toHaveLength(1)

    // The worker restarts; a later relay (sweeper) picks the rows up.
    fetchCalls = []
    succeedOnFetch()
    const relay = await relaySideEffectIntents({ db: createDb(sqliteHandle.d1), env, kv })
    expect(relay.failed).toEqual([])
    expect(relay.claimed).toBeGreaterThanOrEqual(2)
    expect(Object.values(statusByKind()).every((status) => status === 'done')).toBe(true)
    expect(fetchCalls.some((url) => url.includes('/zones/zone-test/purge_cache'))).toBe(true)
    expect(fetchCalls).toContain(REVALIDATE_URL)

    // Done rows are never run again.
    fetchCalls = []
    const again = await relaySideEffectIntents({ db: createDb(sqliteHandle.d1), env, kv })
    expect(again.claimed).toBe(0)
    expect(fetchCalls).toEqual([])
  })

  it('a failed purge stays pending with a backoff and is retried once the backoff passes', async () => {
    failOnFetch()
    await executeCommand(ctx(), command('publishNow'))
    await settle()

    const purge = intents().find((row) => row.kind === 'cdn_purge')
    expect(purge?.status).toBe('pending')
    expect(purge?.attempts).toBe(1)
    expect(purge?.next_attempt_at).not.toBeNull()

    succeedOnFetch()
    const early = await relaySideEffectIntents({ db: createDb(sqliteHandle.d1), env, kv })
    expect(early.claimed).toBe(0)

    const later = await relaySideEffectIntents(
      { db: createDb(sqliteHandle.d1), env, kv },
      { now: Date.now() + 10 * 60_000 }
    )
    expect(later.failed).toEqual([])
    expect(Object.values(statusByKind()).every((status) => status === 'done')).toBe(true)
  })

  it('the opportunistic sweep leaves fresh rows alone', async () => {
    crashOnFetch()
    await executeCommand(ctx(), command('publishNow'))
    await settle()
    succeedOnFetch()
    const sweep = await relaySideEffectIntents(
      { db: createDb(sqliteHandle.d1), env, kv },
      { staleOnlyMs: 60_000 }
    )
    expect(sweep.claimed).toBe(0)
  })

  it('stops retrying after the last attempt', async () => {
    failOnFetch()
    await executeCommand(ctx(), command('publishNow'))
    await settle()
    sqlite.exec(
      `update side_effect_intents set attempts = ${SIDE_EFFECT_MAX_ATTEMPTS - 1}, next_attempt_at = null
       where status = 'pending'`
    )
    await relaySideEffectIntents({ db: createDb(sqliteHandle.d1), env, kv })
    const purge = intents().find((row) => row.kind === 'cdn_purge')
    expect(purge?.status).toBe('failed')
    expect(purge?.attempts).toBe(SIDE_EFFECT_MAX_ATTEMPTS)
    expect(statusByKind().frontend_revalidate).toBe('failed')
    const next = await relaySideEffectIntents(
      { db: createDb(sqliteHandle.d1), env, kv },
      { now: Date.now() + 24 * 60 * 60_000 }
    )
    expect(next.claimed).toBe(0)
  })

  it('unpublish and delete remove the entry from the FTS index', async () => {
    succeedOnFetch()
    await executeCommand(ctx(), command('publishNow'))
    await settle()
    expect(await ftsService.search(createDb(sqliteHandle.d1), 'durable', TENANT)).toHaveLength(1)

    await executeCommand(ctx(), command('unpublishNow'))
    await settle()
    expect(await ftsService.search(createDb(sqliteHandle.d1), 'durable', TENANT)).toEqual([])
    // Unpublish indexes nothing for RAG.
    expect(
      (
        sqlite
          .query(`select count(*) as n from side_effect_intents where kind = 'rag_index'`)
          .get() as { n: number }
      ).n
    ).toBe(1)

    await executeCommand(ctx(), command('publishNow'))
    await settle()
    await executeCommand(ctx(), command('deleteEntry'))
    await settle()
    expect(await ftsService.search(createDb(sqliteHandle.d1), 'durable', TENANT)).toEqual([])
  })

  it('a late FTS retry converges on the current entry state', async () => {
    succeedOnFetch()
    await executeCommand(ctx(), command('publishNow'))
    await settle()
    await executeCommand(ctx(), command('unpublishNow'))
    await settle()
    // Replay the stale publish-time FTS intent: it must not re-index a draft.
    await runSideEffectIntents({ db: createDb(sqliteHandle.d1), env, kv }, [
      {
        id: 'replay',
        kind: 'fts_sync',
        tenantScope: TENANT,
        commandId: null,
        payload: { entryId: 'entry-1', tenantId: TENANT },
        attempts: 0,
      },
    ])
    expect(await ftsService.search(createDb(sqliteHandle.d1), 'durable', TENANT)).toEqual([])
  })

  it('a dry run or a failed command writes no intents', async () => {
    succeedOnFetch()
    await executeCommand(ctx(), { ...command('publishNow'), dryRun: true })
    // unpublishNow on a draft entry is an invalid transition.
    const failed = await executeCommand(ctx(), command('unpublishNow'))
    expect(failed.status).toBe('failed')
    expect(intents()).toEqual([])
  })
})
