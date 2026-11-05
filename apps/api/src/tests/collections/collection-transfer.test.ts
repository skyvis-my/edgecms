import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createSqliteD1 } from '../helpers/sqlite-d1'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { createDb } = await import('@/database/db')
const { __resetPreviewReceiptStoreForTests } = await import('@/ai/preview-receipt.service')
const { createContentAccess, READ_ONLY_CONTENT_ACCESS } = await import('@/auth/content-access')
const { collectionTransferService, COLLECTION_EXPORT_FORMAT } = await import(
  '@/collections/collection-transfer.service'
)

type Doc = Awaited<ReturnType<typeof exportOk>>

/**
 * OP-06: collection export and non-destructive import preview. Runs the real
 * engine, handlers and receipt service against SQLite with every migration.
 */

const TENANT_A = 't-a'
const TENANT_B = 't-b'
const WRITE_TABLES = [
  'entries',
  'entry_versions',
  'relations',
  'audit_log',
  'audit_events',
  'webhook_outbox',
  'change_log',
  'schedule_intents',
  'preview_receipt_redemptions',
] as const

const POST_FIELDS = [
  { name: 'title', type: 'text', required: true, localizable: true },
  { name: 'views', type: 'number', required: false, localizable: false },
  {
    name: 'author',
    type: 'relation',
    required: false,
    localizable: false,
    options: { relationType: 'one-to-one', targetCollection: 'authors' },
  },
  {
    name: 'related',
    type: 'relation',
    required: false,
    localizable: false,
    options: { relationType: 'many-to-many', targetCollection: 'posts' },
  },
]
const AUTHOR_FIELDS = [{ name: 'name', type: 'text', required: true, localizable: false }]

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

function setup() {
  const { d1, sqlite } = createSqliteD1()
  const now = new Date().toISOString()
  const q = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'`
  const tenant = (id: string, slug: string) => `
    INSERT INTO tenants (id, slug, name, status, createdAt, updatedAt, localeCatalog, mediaUploadMaxBytes, mediaUploadMaxDimension, mediaAllowedMimeTypes, aiEnabled, requireMfa)
    VALUES ('${id}', '${slug}', '${slug}', 'active', '${now}', '${now}', '[]', 1000000, 4000, '[]', 1, 0);`
  const collection = (id: string, tenantId: string, slug: string, fields: unknown) => `
    INSERT INTO collections (id, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt, tenantId)
    VALUES ('${id}', '${slug}', '${slug}', 0, ${q(fields)}, 'en', '["en","fr"]', '${now}', '${now}', '${tenantId}');`
  const entry = (id: string, collectionId: string, slug: string, status: string, data: unknown) => `
    INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
    VALUES ('${id}', '${collectionId}', '${slug}', '${status}', ${q(data)}, 1, '${now}', '${now}');`
  const relation = (id: string, src: string, tgt: string, sc: string, tc: string, type: string, field: string, sort: number) => `
    INSERT INTO relations (id, sourceEntryId, targetEntryId, sourceCollectionId, targetCollectionId, relationType, fieldName, sortOrder, tenantId, createdAt, updatedAt)
    VALUES ('${id}', '${src}', '${tgt}', '${sc}', '${tc}', '${type}', '${field}', ${sort}, '${TENANT_A}', '${now}', '${now}');`

  sqlite.exec(`
    ${tenant(TENANT_A, 'alpha')}
    ${tenant(TENANT_B, 'beta')}
    ${collection('a-posts', TENANT_A, 'posts', POST_FIELDS)}
    ${collection('a-authors', TENANT_A, 'authors', AUTHOR_FIELDS)}
    ${entry('a-ada', 'a-authors', 'ada', 'draft', { name: 'Ada' })}
    ${entry('a-p1', 'a-posts', 'hello', 'published', { title: { en: 'Hello', fr: 'Bonjour' }, views: 3, author: 'a-ada' })}
    ${entry('a-p2', 'a-posts', 'second', 'draft', { title: { en: 'Second' } })}
    ${relation('r1', 'a-p1', 'a-ada', 'a-posts', 'a-authors', 'one-to-one', 'author', 0)}
    ${relation('r2', 'a-p1', 'a-p2', 'a-posts', 'a-posts', 'many-to-many', 'related', 0)}
    ${collection('b-posts', TENANT_B, 'posts', POST_FIELDS)}
    ${collection('b-authors', TENANT_B, 'authors', AUTHOR_FIELDS)}
    ${entry('b-ada', 'b-authors', 'ada', 'draft', { name: 'Ada' })}
  `)
  const db = createDb(d1)
  const kv = createKv()
  const count = (table: string) =>
    (sqlite.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  const snapshot = () => Object.fromEntries(WRITE_TABLES.map((t) => [t, count(t)]))
  const ctx = (tenantId: string, userId = 'u1', extra: Record<string, unknown> = {}) => ({
    db,
    kv,
    tenantId,
    actor: { userId },
    ...extra,
  })
  return { sqlite, db, kv, count, snapshot, ctx }
}

let env: ReturnType<typeof setup>

async function exportOk(tenantId: string, slug = 'posts') {
  const result = await collectionTransferService.exportCollection(env.ctx(tenantId), slug)
  if (!result.success) throw new Error(`export failed: ${result.error.code}`)
  return result.data
}

async function previewOk(tenantId: string, document: unknown, options: Record<string, unknown> = {}) {
  const result = await collectionTransferService.previewImport(env.ctx(tenantId), 'posts', {
    document,
    ...options,
  })
  if (!result.success) throw new Error(`preview failed: ${result.error.code} ${result.error.message}`)
  return result.data
}

function stripVolatile(doc: Doc) {
  const { exportedAt: _exportedAt, ...rest } = doc
  return rest
}

beforeEach(() => {
  __resetPreviewReceiptStoreForTests()
  env = setup()
})

describe('OP-06 collection export', () => {
  it('exports entries with locales, relations by slug and a schema version', async () => {
    const doc = await exportOk(TENANT_A)
    expect(doc.format).toBe(COLLECTION_EXPORT_FORMAT)
    expect(doc.formatVersion).toBe(1)
    expect(doc.collection.slug).toBe('posts')
    expect(doc.collection.supportedLocales).toEqual(['en', 'fr'])
    expect(doc.collection.schemaHash).toMatch(/^[0-9a-f]{64}$/)
    expect(doc.entries.map((e) => e.slug)).toEqual(['hello', 'second'])

    const hello = doc.entries.find((e) => e.slug === 'hello')
    expect(hello?.status).toBe('published')
    // Locales survive; relation fields hold source-tenant ids, so they move
    // to `relations` as stable slugs instead of staying in data.
    expect(hello?.data).toEqual({ title: { en: 'Hello', fr: 'Bonjour' }, views: 3 })
    expect(doc.relations).toEqual([
      {
        sourceSlug: 'hello',
        fieldName: 'author',
        relationType: 'one-to-one',
        sortOrder: 0,
        target: { collectionSlug: 'authors', slug: 'ada' },
      },
      {
        sourceSlug: 'hello',
        fieldName: 'related',
        relationType: 'many-to-many',
        sortOrder: 0,
        target: { collectionSlug: 'posts', slug: 'second' },
      },
    ])
    expect(JSON.stringify(doc)).not.toContain('a-p1')
  })

  it('is tenant-scoped: another tenant sees only its own collection', async () => {
    const doc = await exportOk(TENANT_B)
    expect(doc.entries).toEqual([])
    const missing = await collectionTransferService.exportCollection(env.ctx('t-none'), 'posts')
    expect(missing.success).toBe(false)
    if (!missing.success) expect(missing.error.code).toBe('NOT_FOUND')
  })

  it('needs read access to the collection (PL-03)', async () => {
    const denied = await collectionTransferService.exportCollection(
      env.ctx(TENANT_A, 'u1', { contentAccess: createContentAccess([]) }),
      'posts'
    )
    expect(denied.success).toBe(false)
    if (!denied.success) expect(denied.error.code).toBe('FORBIDDEN')
  })
})

describe('OP-06 import preview', () => {
  it('writes no content and returns a per-entry plan with a receipt', async () => {
    const doc = await exportOk(TENANT_A)
    const before = env.snapshot()

    const preview = await previewOk(TENANT_B, doc)

    expect(env.snapshot()).toEqual(before)
    expect(preview.previewReceipt).toMatch(/^rcpt_/)
    expect(preview.expiresAt).toBeTruthy()
    expect(preview.summary).toEqual({ create: 2, update: 0, skip: 0, conflict: 0, invalid: 0 })
    expect(preview.entries).toEqual([
      expect.objectContaining({ slug: 'hello', action: 'create', publish: true }),
      expect.objectContaining({ slug: 'second', action: 'create', publish: false }),
    ])
    expect(preview.relations).toEqual([
      expect.objectContaining({ sourceSlug: 'hello', fieldName: 'author', action: 'link' }),
      expect.objectContaining({ sourceSlug: 'hello', fieldName: 'related', action: 'link' }),
    ])
    // The engine dry-run diff for the concrete commands is returned.
    expect(preview.diff.length).toBeGreaterThan(0)
  })

  it('skips unchanged entries, flags changed ones as conflicts unless asked to update', async () => {
    const doc = await exportOk(TENANT_A)
    env.sqlite.exec(`
      INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
      VALUES ('b-p2', 'b-posts', 'second', 'draft', '{"title":{"en":"Second"}}', 1, 'x', 'x'),
             ('b-p1', 'b-posts', 'hello', 'draft', '{"title":{"en":"Old"}}', 4, 'x', 'x');
    `)

    const skip = await previewOk(TENANT_B, doc)
    expect(skip.entries).toEqual([
      expect.objectContaining({ slug: 'hello', action: 'conflict', reason: 'EXISTS_WITH_DIFFERENT_CONTENT' }),
      expect.objectContaining({ slug: 'second', action: 'skip', reason: 'UNCHANGED' }),
    ])
    // A conflicting source is not imported, so its relations are not either.
    expect(skip.relations.every((r) => r.action === 'skip')).toBe(true)

    const update = await previewOk(TENANT_B, doc, { strategy: 'update' })
    expect(update.entries[0]).toEqual(
      expect.objectContaining({
        slug: 'hello',
        action: 'update',
        entryId: 'b-p1',
        changedFields: ['title', 'views'],
      })
    )
  })

  it('reports validation errors per entry and never imports invalid rows', async () => {
    const doc = await exportOk(TENANT_A)
    doc.entries.push(
      { slug: 'bad-locale', status: 'draft', data: { title: { de: 'Hallo' } } },
      { slug: 'bad-type', status: 'draft', data: { title: { en: 'x' }, views: 'many' } },
      { slug: 'unknown-field', status: 'draft', data: { title: { en: 'x' }, extra: 1 } },
      { slug: 'Not A Slug', status: 'draft', data: { title: { en: 'x' } } },
      { slug: 'second', status: 'draft', data: { title: { en: 'dup' } } }
    )
    const preview = await previewOk(TENANT_B, doc)
    const bySlug = Object.fromEntries(preview.entries.map((e) => [e.slug, e]))
    expect(bySlug['bad-locale']?.action).toBe('invalid')
    expect(bySlug['bad-locale']?.validationErrors?.[0]).toContain("unsupported locale 'de'")
    expect(bySlug['bad-type']?.validationErrors?.[0]).toContain("'views' must be a finite number")
    expect(bySlug['unknown-field']?.validationErrors?.[0]).toContain("'extra'")
    expect(bySlug['Not A Slug']?.action).toBe('invalid')
    expect(preview.entries.filter((e) => e.slug === 'second').map((e) => e.action)).toEqual([
      'create',
      'conflict',
    ])
    expect(preview.summary.invalid).toBe(4)
  })

  it('marks a relation whose target is missing in this tenant as a conflict', async () => {
    const doc = await exportOk(TENANT_A)
    env.sqlite.exec(`DELETE FROM entries WHERE id = 'b-ada'`)
    const preview = await previewOk(TENANT_B, doc)
    expect(preview.relations[0]).toEqual(
      expect.objectContaining({ fieldName: 'author', action: 'conflict', reason: 'TARGET_NOT_FOUND' })
    )
  })

  it('rejects a document that is not a collection export', async () => {
    const result = await collectionTransferService.previewImport(env.ctx(TENANT_B), 'posts', {
      document: { format: 'something-else', entries: [] },
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('INVALID_EXPORT')
  })

  it('needs create and publish access for the planned commands (PL-03)', async () => {
    const doc = await exportOk(TENANT_A)
    const readOnly = await collectionTransferService.previewImport(
      env.ctx(TENANT_B, 'u1', { contentAccess: READ_ONLY_CONTENT_ACCESS }),
      'posts',
      { document: doc }
    )
    expect(readOnly.success).toBe(false)
    if (!readOnly.success) expect(readOnly.error.code).toBe('FORBIDDEN')

    const noPublish = await collectionTransferService.previewImport(
      env.ctx(TENANT_B, 'u1', {
        contentAccess: createContentAccess([
          { subject: 'entry:posts', action: 'read' },
          { subject: 'entry:posts', action: 'create' },
          { subject: 'entry:posts', action: 'update' },
          { subject: 'entry:authors', action: 'read' },
        ] as never),
      }),
      'posts',
      { document: doc }
    )
    expect(noPublish.success).toBe(false)
    if (!noPublish.success) expect(noPublish.error.code).toBe('FORBIDDEN')
  })
})

describe('OP-06 import execute', () => {
  it('round-trips export into an empty tenant', async () => {
    const source = await exportOk(TENANT_A)
    const preview = await previewOk(TENANT_B, source)

    const result = await collectionTransferService.executeImport(env.ctx(TENANT_B), 'posts', {
      document: source,
      previewReceipt: preview.previewReceipt as string,
    })
    if (!result.success) throw new Error(`${result.error.code}: ${result.error.message}`)
    expect(result.data.status).toBe('applied')
    expect(result.data.entries.map((e) => [e.slug, e.action, e.outcome])).toEqual([
      ['hello', 'create', 'success'],
      ['second', 'create', 'success'],
    ])

    const target = await exportOk(TENANT_B)
    expect(stripVolatile(target)).toEqual(stripVolatile(source))

    // Tenant A is untouched.
    expect(
      env.sqlite.query(`SELECT COUNT(*) AS n FROM entries WHERE collectionId = 'a-posts'`).get()
    ).toEqual({ n: 2 })
  })

  it('a second import of the same file is all skips', async () => {
    const source = await exportOk(TENANT_A)
    const first = await previewOk(TENANT_B, source)
    await collectionTransferService.executeImport(env.ctx(TENANT_B), 'posts', {
      document: source,
      previewReceipt: first.previewReceipt as string,
    })
    const again = await previewOk(TENANT_B, source)
    expect(again.summary).toEqual({ create: 0, update: 0, skip: 2, conflict: 0, invalid: 0 })
    expect(again.relations.every((r) => r.action === 'skip')).toBe(true)
    expect(again.previewReceipt).toBeUndefined()
  })

  it('applies an update with the previewed version', async () => {
    const source = await exportOk(TENANT_A)
    env.sqlite.exec(`
      INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
      VALUES ('b-p1', 'b-posts', 'hello', 'draft', '{"title":{"en":"Old"},"keep":1}', 4, 'x', 'x');
    `)
    const preview = await previewOk(TENANT_B, source, { strategy: 'update' })
    const result = await collectionTransferService.executeImport(env.ctx(TENANT_B), 'posts', {
      document: source,
      strategy: 'update',
      previewReceipt: preview.previewReceipt as string,
    })
    expect(result.success).toBe(true)
    const row = env.sqlite.query(`SELECT data, version FROM entries WHERE id = 'b-p1'`).get() as {
      data: string
      version: number
    }
    // Fields the file does not mention are kept (non-destructive merge).
    expect(JSON.parse(row.data)).toEqual({ title: { en: 'Hello', fr: 'Bonjour' }, views: 3, keep: 1 })
    expect(row.version).toBe(5)
  })

  it('refuses to execute without a receipt and writes nothing', async () => {
    const source = await exportOk(TENANT_A)
    const before = env.snapshot()
    const result = await collectionTransferService.executeImport(env.ctx(TENANT_B), 'posts', {
      document: source,
      previewReceipt: '',
    })
    expect(result.success).toBe(false)
    expect(env.snapshot()).toEqual(before)
  })

  it('refuses a plan that changed since preview, without spending the receipt', async () => {
    const source = await exportOk(TENANT_A)
    const preview = await previewOk(TENANT_B, source)
    env.sqlite.exec(`
      INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
      VALUES ('b-race', 'b-posts', 'second', 'draft', '{"title":{"en":"Raced"}}', 1, 'x', 'x');
    `)
    const before = env.snapshot()
    const result = await collectionTransferService.executeImport(env.ctx(TENANT_B), 'posts', {
      document: source,
      previewReceipt: preview.previewReceipt as string,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('IMPORT_PLAN_CHANGED')
      expect(result.error.reason).toBe('HASH_MISMATCH')
    }
    expect(env.snapshot()).toEqual(before)

    // A different strategy is a different plan too.
    const other = await collectionTransferService.executeImport(env.ctx(TENANT_B), 'posts', {
      document: source,
      strategy: 'update',
      previewReceipt: preview.previewReceipt as string,
    })
    expect(other.success).toBe(false)
  })

  it('rejects replay, another actor and another tenant', async () => {
    const source = await exportOk(TENANT_A)
    const preview = await previewOk(TENANT_B, source)
    const receipt = preview.previewReceipt as string

    const otherActor = await collectionTransferService.executeImport(env.ctx(TENANT_B, 'u2'), 'posts', {
      document: source,
      previewReceipt: receipt,
    })
    expect(otherActor.success).toBe(false)
    if (!otherActor.success) expect(otherActor.error.reason).toBe('ACTOR_MISMATCH')

    const otherTenant = await collectionTransferService.executeImport(env.ctx(TENANT_A), 'posts', {
      document: source,
      previewReceipt: receipt,
    })
    expect(otherTenant.success).toBe(false)

    const ok = await collectionTransferService.executeImport(env.ctx(TENANT_B), 'posts', {
      document: source,
      previewReceipt: receipt,
    })
    expect(ok.success).toBe(true)
    const entriesAfter = env.count('entries')

    const replay = await collectionTransferService.executeImport(env.ctx(TENANT_B), 'posts', {
      document: source,
      previewReceipt: receipt,
    })
    expect(replay.success).toBe(false)
    expect(env.count('entries')).toBe(entriesAfter)
  })
})
