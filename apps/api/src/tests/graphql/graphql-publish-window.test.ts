/**
 * DL-06 / P5: GraphQL list, single-item and singleton queries must apply the
 * same public visibility rule as public REST (status published|scheduled,
 * publishAt <= now, unpublishAt > now), and a single-item lookup by id must
 * not return an entry from a different collection.
 *
 * Runs against real SQLite with every migration applied, through the same
 * schema builder the /api/graphql route executes.
 */
import { beforeAll, describe, expect, it } from 'bun:test'
import { execute, parse } from 'graphql'
import { createDb } from '@/database/db'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const { buildDynamicGraphQLSchema, clearGraphQLSchemaCache } = await import(
  `../../graphql/graphql-schema.builder?bypass=${Date.now()}`
)

const TENANT = 'global'
const PAST = '2020-01-01T00:00:00.000Z'
const FUTURE = '2999-01-01T00:00:00.000Z'

const ARTICLES: Array<{ id: string; status: string; publishAt?: string; unpublishAt?: string }> = [
  { id: 'live', status: 'published' },
  { id: 'draft', status: 'draft' },
  { id: 'archived', status: 'archived' },
  { id: 'scheduled-future', status: 'scheduled', publishAt: FUTURE },
  { id: 'scheduled-live', status: 'scheduled', publishAt: PAST },
  { id: 'published-future', status: 'published', publishAt: FUTURE },
  { id: 'expired', status: 'published', unpublishAt: PAST },
  { id: 'window-open', status: 'published', publishAt: PAST, unpublishAt: FUTURE },
]
const VISIBLE = ['live', 'scheduled-live', 'window-open'].sort()
const HIDDEN = ARTICLES.map((a) => a.id).filter((id) => !VISIBLE.includes(id))

function seed(settings: { status: string; publishAt?: string; unpublishAt?: string }) {
  const { d1, sqlite } = createSqliteD1()
  const now = '2024-01-01T00:00:00.000Z'
  const insertCollection = sqlite.prepare(
    `INSERT INTO collections (id, tenantId, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'en', '["en"]', ?, ?)`
  )
  const fields = JSON.stringify([{ name: 'title', type: 'text', localizable: false }])
  insertCollection.run('col-articles', TENANT, 'Articles', 'articles', 0, fields, now, now)
  insertCollection.run('col-pages', TENANT, 'Pages', 'pages', 0, fields, now, now)
  insertCollection.run('col-settings', TENANT, 'Settings', 'settings', 1, fields, now, now)

  const insertEntry = sqlite.prepare(
    `INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt, publish_at, unpublish_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  )
  for (const a of ARTICLES) {
    insertEntry.run(
      a.id,
      'col-articles',
      a.id,
      a.status,
      JSON.stringify({ title: a.id }),
      now,
      now,
      a.publishAt ?? null,
      a.unpublishAt ?? null
    )
  }
  insertEntry.run(
    'page-1',
    'col-pages',
    'page-1',
    'published',
    JSON.stringify({ title: 'page' }),
    now,
    now,
    null,
    null
  )
  insertEntry.run(
    'settings-1',
    'col-settings',
    'settings-1',
    settings.status,
    JSON.stringify({ title: 'settings' }),
    now,
    now,
    settings.publishAt ?? null,
    settings.unpublishAt ?? null
  )
  return createDb(d1)
}

async function run(db: ReturnType<typeof createDb>, query: string) {
  clearGraphQLSchemaCache()
  const schema = await buildDynamicGraphQLSchema(db, TENANT)
  const result = await execute({ schema, document: parse(query) })
  expect(result.errors).toBeUndefined()
  return result.data as Record<string, unknown>
}

describe('GraphQL applies the public publish window (DL-06, P5)', () => {
  let db: ReturnType<typeof createDb>
  beforeAll(() => {
    db = seed({ status: 'published' })
  })

  it('list query returns only entries inside their publish window', async () => {
    const data = await run(db, '{ articles(perPage: 100) { id } }')
    const ids = (data.articles as Array<{ id: string }>).map((e) => e.id).sort()
    expect(ids).toEqual(VISIBLE)
  })

  it('single-item query by id returns visible entries and null for hidden ones', async () => {
    for (const id of VISIBLE) {
      const data = await run(db, `{ article(id: "${id}") { id } }`)
      expect(data.article).toEqual({ id })
    }
    for (const id of HIDDEN) {
      const data = await run(db, `{ article(id: "${id}") { id } }`)
      expect(data.article).toBeNull()
    }
  })

  it('single-item query by slug applies the same window', async () => {
    for (const id of VISIBLE) {
      const data = await run(db, `{ article(slug: "${id}") { id } }`)
      expect(data.article).toEqual({ id })
    }
    for (const id of HIDDEN) {
      const data = await run(db, `{ article(slug: "${id}") { id } }`)
      expect(data.article).toBeNull()
    }
  })

  it('single-item query by id does not return an entry from another collection', async () => {
    const data = await run(db, '{ article(id: "page-1") { id } }')
    expect(data.article).toBeNull()
  })

  it('singleton query returns the visible entry', async () => {
    const data = await run(db, '{ settings { id } }')
    expect(data.settings).toEqual({ id: 'settings-1' })
  })

  it('singleton query hides an entry whose window has not opened', async () => {
    const data = await run(seed({ status: 'published', publishAt: FUTURE }), '{ settings { id } }')
    expect(data.settings).toBeNull()
  })

  it('singleton query hides an expired entry', async () => {
    const data = await run(seed({ status: 'published', unpublishAt: PAST }), '{ settings { id } }')
    expect(data.settings).toBeNull()
  })

  it('singleton query serves a scheduled entry whose window has opened', async () => {
    const data = await run(seed({ status: 'scheduled', publishAt: PAST }), '{ settings { id } }')
    expect(data.settings).toEqual({ id: 'settings-1' })
  })
})
