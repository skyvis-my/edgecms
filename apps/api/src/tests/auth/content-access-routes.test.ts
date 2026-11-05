/**
 * PL-03: the direct entry CRUD and version routes apply per-collection grants
 * that the request guard hands over. Real SQL (bun:sqlite with migrations).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const sqliteHandle = createSqliteD1()
const { sqlite } = sqliteHandle

mock.module('cloudflare:workers', () => ({
  env: { DB: sqliteHandle.d1, CACHE: undefined, MEDIA: undefined },
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
const { entriesController } = await import('@/entries/entries.controller')
const { versioningController } = await import('@/versioning/versioning.controller')

const TENANT = 'tenant-a'
const NOW = '2026-01-01T00:00:00.000Z'
const BLOG_WRITER = createContentAccess([
  { subject: 'entry:blog', action: 'read' },
  { subject: 'entry:blog', action: 'create' },
  { subject: 'entry:blog', action: 'update' },
])

function seed() {
  sqlite.exec('delete from entries; delete from collections; delete from tenants;')
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
    sqlite
      .query(
        `insert into entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
         values (?, ?, ?, 'draft', '{"title":"x"}', 1, ?, ?)`
      )
      .run(`entry-${slug}`, `col-${slug}`, `${slug}-one`, NOW, NOW)
  }
}

type Access = ReturnType<typeof createContentAccess>

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
    .use(entriesController)
    .use(versioningController)
}

async function call(access: Access, method: string, path: string, body?: unknown) {
  return buildApp(access).handle(
    new Request(`http://localhost/api/admin/entries${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  )
}

function entryCount(collectionId: string): number {
  return (sqlite.query('select count(*) as c from entries where collectionId = ?').get(collectionId) as { c: number }).c
}

beforeEach(() => seed())

describe('entry routes with a collection-limited role', () => {
  // [route, method, path, body, expected status for blog-writer]
  const cases: Array<[string, string, string, unknown, number]> = [
    ['list granted collection', 'GET', '?collectionId=col-blog', undefined, 200],
    ['list granted collection by slug', 'GET', '?collectionSlug=blog', undefined, 200],
    ['list other collection', 'GET', '?collectionId=col-news', undefined, 403],
    ['list without a collection', 'GET', '', undefined, 403],
    ['get granted entry', 'GET', '/entry-blog', undefined, 200],
    ['get other entry', 'GET', '/entry-news', undefined, 403],
    ['batch with other entry', 'GET', '/batch?ids=entry-blog,entry-news', undefined, 403],
    ['create in other collection', 'POST', '', { collectionId: 'col-news', data: { title: 'n' } }, 403],
    ['update other entry', 'PUT', '/entry-news', { data: { title: 'n' } }, 403],
    ['delete own collection entry (no delete grant)', 'DELETE', '/entry-blog', undefined, 403],
    ['duplicate other entry', 'POST', '/entry-news/duplicate', undefined, 403],
    ['versions of other entry', 'GET', '/entry-news/versions', undefined, 403],
    ['rollback other entry', 'POST', '/entry-news/versions/v1/rollback', undefined, 403],
  ]

  for (const [name, method, path, body, expected] of cases) {
    it(`${name}: ${expected}`, async () => {
      const response = await call(BLOG_WRITER, method, path, body)
      expect(response.status).toBe(expected)
      if (expected === 403) {
        const json = (await response.json()) as { error?: { code?: string } }
        expect(json.error?.code).toBe('FORBIDDEN')
      }
    })
  }

  it('creates inside the granted collection', async () => {
    const response = await call(BLOG_WRITER, 'POST', '', {
      collectionId: 'col-blog',
      slug: 'blog-two',
      data: { title: 'b' },
    })
    expect(response.status).toBe(201)
    expect(entryCount('col-blog')).toBe(2)
  })

  it('leaves rows untouched on denied writes', async () => {
    await call(BLOG_WRITER, 'POST', '', { collectionId: 'col-news', data: { title: 'n' } })
    await call(BLOG_WRITER, 'DELETE', '/entry-news')
    expect(entryCount('col-news')).toBe(1)
  })

  it('keeps full access unrestricted', async () => {
    expect((await call(FULL_CONTENT_ACCESS, 'GET', '')).status).toBe(200)
    expect((await call(FULL_CONTENT_ACCESS, 'GET', '/entry-news')).status).toBe(200)
  })
})
