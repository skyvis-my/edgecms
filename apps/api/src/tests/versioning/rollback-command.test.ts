/**
 * CM-06 / P3: version rollback is a command. The rollback route must run
 * through the command engine like every other write, so it is recorded in
 * processed_commands and the audit ledger, writes a tenant-scoped change-log
 * row, queues a webhook outbox intent and invalidates caches.
 *
 * Real SQL (bun:sqlite with every migration), real controller, engine,
 * handlers and entries service.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const sqliteHandle = createSqliteD1()
const { sqlite } = sqliteHandle

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
}

mock.module('cloudflare:workers', () => ({
  env: { DB: sqliteHandle.d1, CACHE: kv, MEDIA: undefined },
}))
mock.module('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia({ name: 'mock-auth' }).macro({
    auth: {
      derive() {
        return { user: { id: 'u-1' } }
      },
    },
  }),
}))

const { createContentAccess, FULL_CONTENT_ACCESS, setRequestContentAccess } = await import(
  '@/auth/content-access'
)
const { versioningController } = await import('@/versioning/versioning.controller')
const { executeCommand } = await import('@/commands/engine')
const { createDb } = await import('@/database/db')

const TENANT = 'tenant-a'
const NOW = '2026-01-01T00:00:00.000Z'

type Access = ReturnType<typeof createContentAccess>

function seed(opts: { legacyCurrentVersionRow?: boolean } = {}) {
  sqlite.exec(`
    delete from audit_events; delete from change_log; delete from webhook_outbox;
    delete from processed_commands; delete from entry_versions; delete from entries;
    delete from collections; delete from tenants;
  `)
  sqlite
    .query(
      `insert into tenants (id, slug, name, status, localeCatalog, mediaAllowedMimeTypes, createdAt, updatedAt)
       values (?, 'acme', 'Acme', 'active', '["en"]', '["image/png"]', ?, ?)`
    )
    .run(TENANT, NOW, NOW)
  const fields = JSON.stringify([{ name: 'title', type: 'text', required: false }])
  for (const slug of ['blog', 'news']) {
    sqlite
      .query(
        `insert into collections (id, tenantId, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt)
         values (?, ?, ?, ?, 0, ?, 'en', '["en"]', ?, ?)`
      )
      .run(`col-${slug}`, TENANT, slug, slug, fields, NOW, NOW)
    // The entry is at version 2; version 1 is the snapshot a normal update wrote.
    sqlite
      .query(
        `insert into entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
         values (?, ?, ?, 'draft', '{"title":"v2"}', 2, ?, ?)`
      )
      .run(`entry-${slug}`, `col-${slug}`, `${slug}-one`, NOW, NOW)
    sqlite
      .query(
        `insert into entry_versions (id, entryId, version, data, createdBy, createdAt)
         values (?, ?, 1, '{"title":"v1"}', 'u-1', ?)`
      )
      .run(`${slug}-v1`, `entry-${slug}`, NOW)
    if (opts.legacyCurrentVersionRow) {
      // Older rollbacks wrote a row for the entry's current version.
      sqlite
        .query(
          `insert into entry_versions (id, entryId, version, data, createdBy, createdAt)
           values (?, ?, 2, '{"title":"v2"}', 'u-1', ?)`
        )
        .run(`${slug}-v2-legacy`, `entry-${slug}`, NOW)
    }
  }
}

function buildApp(access: Access) {
  return new Elysia()
    .onRequest(({ request }) => {
      setRequestContentAccess(request, async () => access)
    })
    .derive({ as: 'global' }, () => ({
      tenant: {
        tenant: { id: TENANT, slug: 'acme', name: 'Acme', status: 'active' },
        resources: { mode: 'shared' as const },
      },
    }))
    .use(versioningController)
}

async function rollback(path: string, access: Access = FULL_CONTENT_ACCESS) {
  const response = await buildApp(access).handle(
    new Request(`http://localhost/api/admin/entries${path}`, { method: 'POST' })
  )
  return { response, body: (await response.json()) as Record<string, any> }
}

const count = (sql: string, ...params: string[]) =>
  (sqlite.query(sql).get(...params) as { n: number }).n

const entryRow = (id: string) =>
  sqlite.query('select version, data from entries where id = ?').get(id) as {
    version: number
    data: string
  }

beforeEach(() => {
  kvStore.clear()
  seed()
})

describe('rollback runs through the command engine (CM-06, P3)', () => {
  it('restores the version and keeps the response contract', async () => {
    const { response, body } = await rollback('/entry-blog/versions/blog-v1/rollback')
    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.entry.id).toBe('entry-blog')
    expect(body.data.entry.version).toBe(3)
    expect(body.data.entry.data).toEqual({ title: 'v1' })
    expect(body.data.newVersion.version).toBe(3)
    expect(body.data.newVersion.entryId).toBe('entry-blog')
    expect(typeof body.data.message).toBe('string')
    expect(entryRow('entry-blog')).toEqual({ version: 3, data: '{"title":"v1"}' })
  })

  it('records the command, audit event, change log and webhook outbox intent', async () => {
    const { response } = await rollback('/entry-blog/versions/blog-v1/rollback')
    expect(response.status).toBe(200)

    expect(
      count(
        `select count(*) as n from processed_commands
         where commandType = 'updateEntry' and status = 'success' and tenantScope = ?`,
        TENANT
      )
    ).toBe(1)
    expect(
      count(
        `select count(*) as n from audit_events
         where category = 'command' and scope = ? and metadata like '%updateEntry%'`,
        TENANT
      )
    ).toBe(1)
    // Sync clients pull change_log by tenant id; the row must carry the command id.
    expect(
      count(
        `select count(*) as n from change_log
         where entityId = 'entry-blog' and tenantScope = ? and commandId is not null`,
        TENANT
      )
    ).toBe(1)
    expect(
      count(`select count(*) as n from webhook_outbox where tenant_scope = ?`, TENANT)
    ).toBe(1)
  })

  it('invalidates caches for the entry collection', async () => {
    const { response } = await rollback('/entry-blog/versions/blog-v1/rollback')
    expect(response.status).toBe(200)
    const purge = response.headers.get('Cache-Tag-Purge') ?? ''
    expect(purge).toContain('blog')
  })

  it('keeps version history consistent so the next edit succeeds', async () => {
    const { response } = await rollback('/entry-blog/versions/blog-v1/rollback')
    expect(response.status).toBe(200)
    // Snapshot of the pre-rollback state, at its own version number.
    expect(
      count(`select count(*) as n from entry_versions where entryId = 'entry-blog' and version = 2`)
    ).toBe(1)

    const result = await executeCommand(
      {
        db: createDb(sqliteHandle.d1),
        actor: { userId: 'u-1', source: 'admin' },
        tenantScope: TENANT,
        syncChannel: TENANT,
      },
      {
        type: 'updateEntry',
        payload: { entryId: 'entry-blog', data: { title: 'v4' } },
        actor: { userId: 'u-1', source: 'admin' },
        optimisticVersion: 3,
        timestamp: new Date().toISOString(),
      }
    )
    expect(result.status).toBe('success')
    expect(entryRow('entry-blog').version).toBe(4)
  })

  it('rolls back an entry that already has a row for its current version', async () => {
    seed({ legacyCurrentVersionRow: true })
    const { response } = await rollback('/entry-blog/versions/blog-v1/rollback')
    expect(response.status).toBe(200)
    expect(entryRow('entry-blog')).toEqual({ version: 3, data: '{"title":"v1"}' })
  })

  it('previews with dryRun=true and writes nothing', async () => {
    const before = count('select count(*) as n from entry_versions')
    const { response, body } = await rollback('/entry-blog/versions/blog-v1/rollback?dryRun=true')
    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.dryRun).toBe(true)
    expect(Array.isArray(body.data.diff)).toBe(true)
    expect(entryRow('entry-blog')).toEqual({ version: 2, data: '{"title":"v2"}' })
    expect(count('select count(*) as n from entry_versions')).toBe(before)
    expect(count('select count(*) as n from change_log')).toBe(0)
    expect(count('select count(*) as n from webhook_outbox')).toBe(0)
  })

  it('denies a role without update on the collection and writes nothing', async () => {
    const blogWriter = createContentAccess([
      { subject: 'entry:blog', action: 'read' },
      { subject: 'entry:blog', action: 'update' },
    ])
    const denied = await rollback('/entry-news/versions/news-v1/rollback', blogWriter)
    expect(denied.response.status).toBe(403)
    expect(entryRow('entry-news').version).toBe(2)

    const allowed = await rollback('/entry-blog/versions/blog-v1/rollback', blogWriter)
    expect(allowed.response.status).toBe(200)
  })

  it('returns 404 for a version of another entry', async () => {
    const { response } = await rollback('/entry-blog/versions/news-v1/rollback')
    expect(response.status).toBe(404)
    expect(entryRow('entry-blog').version).toBe(2)
  })
})
