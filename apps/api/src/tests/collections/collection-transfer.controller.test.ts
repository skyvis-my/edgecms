import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { createSqliteD1 } from '../helpers/sqlite-d1'

/**
 * OP-06 HTTP surface: export → preview → execute over the real controller,
 * service, engine and SQLite (every migration applied).
 */

const workerEnv: { DB?: D1Database; CACHE: KVNamespace; MEDIA: R2Bucket } = {
  CACHE: {
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
  } as unknown as KVNamespace,
  MEDIA: {} as R2Bucket,
}

mock.module('cloudflare:workers', () => ({ env: workerEnv }))
mock.module('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia({ name: 'test-auth' }).macro({
    auth: {
      derive({ request }: { request: Request }) {
        const id = request.headers.get('x-test-user')
        return { user: id ? { id } : undefined }
      },
    },
  }),
}))

const { __resetPreviewReceiptStoreForTests } = await import('@/ai/preview-receipt.service')
const { collectionTransferController } = await import(
  `../../collections/collection-transfer.controller?bypass=${Date.now()}`
)

let sqlite: ReturnType<typeof createSqliteD1>['sqlite']

function appFor(tenantId?: string) {
  const app = new Elysia()
  if (tenantId) {
    app.derive(() => ({
      tenant: {
        tenant: { id: tenantId, slug: tenantId, name: tenantId, status: 'active' },
        resources: { mode: 'shared' as const },
      },
    }))
  }
  return app.use(collectionTransferController)
}

async function call(tenantId: string | undefined, method: string, path: string, body?: unknown) {
  const res = await appFor(tenantId).handle(
    new Request(`http://localhost/api/admin/collections${path}`, {
      method,
      headers: { 'x-test-user': 'u1', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  )
  return { status: res.status, body: (await res.json()) as { success: boolean; data?: any; error?: any } }
}

beforeEach(() => {
  __resetPreviewReceiptStoreForTests()
  const created = createSqliteD1()
  sqlite = created.sqlite
  workerEnv.DB = created.d1
  const now = new Date().toISOString()
  for (const [id, slug] of [
    ['t-a', 'alpha'],
    ['t-b', 'beta'],
  ]) {
    sqlite.exec(`
      INSERT INTO tenants (id, slug, name, status, createdAt, updatedAt, localeCatalog, mediaUploadMaxBytes, mediaUploadMaxDimension, mediaAllowedMimeTypes, aiEnabled, requireMfa)
      VALUES ('${id}', '${slug}', '${slug}', 'active', '${now}', '${now}', '[]', 1000000, 4000, '[]', 1, 0);
      INSERT INTO collections (id, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt, tenantId)
      VALUES ('${id}-posts', 'Posts', 'posts', 0, '[{"name":"title","type":"text","required":true,"localizable":true}]', 'en', '["en","fr"]', '${now}', '${now}', '${id}');
    `)
  }
  sqlite.exec(`
    INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
    VALUES ('a1', 't-a-posts', 'hello', 'published', '{"title":{"en":"Hello","fr":"Bonjour"}}', 1, '${now}', '${now}');
  `)
})

describe('collection transfer routes', () => {
  it('require a tenant', async () => {
    const res = await call(undefined, 'GET', '/posts/export')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('TENANT_REQUIRED')
  })

  it('export, preview and execute a round trip over HTTP', async () => {
    const exported = await call('t-a', 'GET', '/posts/export')
    expect(exported.status).toBe(200)
    const document = exported.body.data

    const entriesBefore = sqlite.query(`SELECT COUNT(*) AS n FROM entries`).get()
    const preview = await call('t-b', 'POST', '/posts/import/preview', { document })
    expect(preview.status).toBe(200)
    expect(preview.body.data.summary.create).toBe(1)
    expect(sqlite.query(`SELECT COUNT(*) AS n FROM entries`).get()).toEqual(entriesBefore)

    const missingReceipt = await call('t-b', 'POST', '/posts/import/execute', { document })
    expect(missingReceipt.status).toBe(422)

    const executed = await call('t-b', 'POST', '/posts/import/execute', {
      document,
      previewReceipt: preview.body.data.previewReceipt,
    })
    expect(executed.status).toBe(200)
    expect(executed.body.data.status).toBe('applied')
    expect(
      sqlite.query(`SELECT slug, status FROM entries WHERE collectionId = 't-b-posts'`).all()
    ).toEqual([{ slug: 'hello', status: 'published' }])

    const replay = await call('t-b', 'POST', '/posts/import/execute', {
      document,
      previewReceipt: preview.body.data.previewReceipt,
    })
    expect(replay.status).toBe(409)
  })

  it('returns 400 for a document that is not a collection export', async () => {
    const res = await call('t-b', 'POST', '/posts/import/preview', { document: { entries: [] } })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_EXPORT')
  })
})
