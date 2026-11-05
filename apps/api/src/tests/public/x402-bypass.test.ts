/**
 * DL-07: paid collections (`premium-*`, `paywall-*`, `paid-*`) must not be
 * readable for free through another anonymous read path. The REST routes run
 * the 402 gate; GraphQL and public relation population have no gate, so they
 * must leave paid content out.
 *
 * Runs against real SQLite with every migration applied.
 */
import { beforeAll, describe, expect, it } from 'bun:test'
import { execute, parse } from 'graphql'
import { createDb } from '@/database/db'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const { buildDynamicGraphQLSchema, clearGraphQLSchemaCache } = await import(
  `../../graphql/graphql-schema.builder?bypass=${Date.now()}`
)
const { snapshotService } = await import(`../../cache/snapshot.service?bypass=${Date.now()}`)
const { relationsResolver } = await import(`../../relations/relations.resolver?bypass=${Date.now()}`)

const TENANT = 'global'

function seed() {
  const { d1, sqlite } = createSqliteD1()
  const now = '2024-01-01T00:00:00.000Z'
  const insertCollection = sqlite.prepare(
    `INSERT INTO collections (id, tenantId, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 0, ?, 'en', '["en"]', ?, ?)`
  )
  const fields = JSON.stringify([
    { name: 'title', type: 'text', localizable: false },
    { name: 'related', type: 'relation', localizable: false },
  ])
  insertCollection.run('col-posts', TENANT, 'Posts', 'posts', fields, now, now)
  insertCollection.run('col-premium', TENANT, 'Premium posts', 'premium-posts', fields, now, now)
  insertCollection.run('col-tags', TENANT, 'Tags', 'tags', fields, now, now)

  const insertEntry = sqlite.prepare(
    `INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
     VALUES (?, ?, ?, 'published', ?, 1, ?, ?)`
  )
  insertEntry.run('post-1', 'col-posts', 'post-1', JSON.stringify({ title: 'free' }), now, now)
  insertEntry.run('paid-1', 'col-premium', 'paid-1', JSON.stringify({ title: 'paid body' }), now, now)
  insertEntry.run('tag-1', 'col-tags', 'tag-1', JSON.stringify({ title: 'tag' }), now, now)

  const insertRelation = sqlite.prepare(
    `INSERT INTO relations (id, sourceEntryId, targetEntryId, sourceCollectionId, targetCollectionId, relationType, fieldName, sortOrder, tenantId, createdAt, updatedAt)
     VALUES (?, 'post-1', ?, 'col-posts', ?, 'many-to-many', 'related', ?, ?, ?, ?)`
  )
  insertRelation.run('rel-paid', 'paid-1', 'col-premium', 0, TENANT, now, now)
  insertRelation.run('rel-tag', 'tag-1', 'col-tags', 1, TENANT, now, now)

  return createDb(d1)
}

function ids(value: unknown): string[] {
  return (value as Array<{ id: string }>).map((e) => e.id)
}

describe('paid collections are not readable for free outside the 402 gate (DL-07)', () => {
  let db: ReturnType<typeof createDb>
  beforeAll(() => {
    db = seed()
  })

  it('GraphQL does not expose paid collections', async () => {
    clearGraphQLSchemaCache()
    const schema = await buildDynamicGraphQLSchema(db, TENANT)
    const fields = Object.keys(schema.getQueryType()!.getFields())
    expect(fields).toContain('posts')
    expect(fields.some((name) => name.toLowerCase().includes('premium'))).toBe(false)

    const result = await execute({ schema, document: parse('{ _collections { slug } }') })
    const data = result.data as { _collections: Array<{ slug: string }> }
    const slugs = data._collections.map((c) => c.slug)
    expect(slugs).not.toContain('premium-posts')
  })

  it('public populate drops related entries from paid collections', async () => {
    const entrySnap = await snapshotService.generateEntrySnapshot(db, 'posts', 'post-1', 'en', undefined, {
      populate: ['related'],
      depth: 1,
    })
    expect(ids(entrySnap?.entry.data.related)).toEqual(['tag-1'])

    const listSnap = await snapshotService.generateListSnapshot(db, 'posts', 'en')
    const post = listSnap?.entries.find((e: { id: string }) => e.id === 'post-1')
    expect(ids(post?.data.related)).toEqual(['tag-1'])
  })

  it('admin (non-public) populate still returns paid related entries', async () => {
    const post = {
      id: 'post-1',
      collectionId: 'col-posts',
      slug: 'post-1',
      status: 'published',
      data: { title: 'free' },
      version: 1,
      createdAt: '',
      updatedAt: '',
      publishAt: null,
      unpublishAt: null,
    }
    const populated = await relationsResolver.populate(db, post, ['related'], 1, 1, new Set(), undefined)
    expect(ids(populated.data.related).sort()).toEqual(['paid-1', 'tag-1'])
  })
})
