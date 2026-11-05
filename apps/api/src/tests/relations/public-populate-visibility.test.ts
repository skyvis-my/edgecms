/**
 * CM-04 / P5: public `populate` must only resolve related entries that are
 * inside their publish window — the same rule the public list/get uses
 * (status published|scheduled, publishAt <= now, unpublishAt > now).
 *
 * Runs against real SQLite with every migration applied, through the same
 * snapshot functions the public REST routes call on a cache miss.
 */
import { beforeAll, describe, expect, it } from 'bun:test'
import { createDb } from '@/database/db'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const { snapshotService } = await import(`../../cache/snapshot.service?bypass=${Date.now()}`)
const { relationsResolver } = await import(`../../relations/relations.resolver?bypass=${Date.now()}`)
const { createPublicVisibility } = await import('@/entries/public-visibility')

const TENANT = 'global'
const PAST = '2020-01-01T00:00:00.000Z'
const FAR_FUTURE = '2999-01-01T00:00:00.000Z'
// Within the 1h max TTL window so it must shorten the snapshot TTL.
const SOON = new Date(Date.now() + 10 * 60 * 1000).toISOString()

const AUTHORS: Array<{ id: string; status: string; publishAt?: string; unpublishAt?: string }> = [
  { id: 'a-live', status: 'published' },
  { id: 'a-draft', status: 'draft' },
  { id: 'a-archived', status: 'archived' },
  { id: 'a-scheduled-future', status: 'scheduled', publishAt: SOON },
  { id: 'a-scheduled-live', status: 'scheduled', publishAt: PAST },
  { id: 'a-published-future', status: 'published', publishAt: FAR_FUTURE },
  { id: 'a-expired', status: 'published', unpublishAt: PAST },
  { id: 'a-window-open', status: 'published', publishAt: PAST, unpublishAt: FAR_FUTURE },
]
const VISIBLE = ['a-live', 'a-scheduled-live', 'a-window-open']

function seed() {
  const { d1, sqlite } = createSqliteD1()
  const now = '2024-01-01T00:00:00.000Z'
  const insertCollection = sqlite.prepare(
    `INSERT INTO collections (id, tenantId, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 0, ?, 'en', '["en"]', ?, ?)`
  )
  insertCollection.run(
    'col-posts',
    TENANT,
    'Posts',
    'posts',
    JSON.stringify([
      { name: 'title', type: 'text', localizable: false },
      { name: 'authors', type: 'relation', localizable: false },
    ]),
    now,
    now
  )
  insertCollection.run(
    'col-authors',
    TENANT,
    'Authors',
    'authors',
    JSON.stringify([{ name: 'name', type: 'text', localizable: false }]),
    now,
    now
  )

  const insertEntry = sqlite.prepare(
    `INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt, publish_at, unpublish_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  )
  insertEntry.run(
    'post-1',
    'col-posts',
    'post-1',
    'published',
    JSON.stringify({ title: 'Hello', authors: AUTHORS.map((a) => a.id) }),
    now,
    now,
    null,
    null
  )
  for (const a of AUTHORS) {
    insertEntry.run(
      a.id,
      'col-authors',
      a.id,
      a.status,
      JSON.stringify({ name: a.id }),
      now,
      now,
      a.publishAt ?? null,
      a.unpublishAt ?? null
    )
  }

  const insertRelation = sqlite.prepare(
    `INSERT INTO relations (id, sourceEntryId, targetEntryId, sourceCollectionId, targetCollectionId, relationType, fieldName, sortOrder, tenantId, createdAt, updatedAt)
     VALUES (?, 'post-1', ?, 'col-posts', 'col-authors', 'many-to-many', 'authors', ?, ?, ?, ?)`
  )
  AUTHORS.forEach((a, i) => insertRelation.run(`rel-${a.id}`, a.id, i, TENANT, now, now))

  return createDb(d1)
}

function ids(value: unknown): string[] {
  return (value as Array<{ id: string }>).map((e) => e.id)
}

describe('public populate only resolves related entries inside their publish window (CM-04)', () => {
  let db: ReturnType<typeof createDb>
  beforeAll(() => {
    db = seed()
  })

  it('entry snapshot with populate omits draft, archived, scheduled-future and expired relations', async () => {
    const snapshot = await snapshotService.generateEntrySnapshot(db, 'posts', 'post-1', 'en', undefined, {
      populate: ['authors'],
      depth: 1,
    })
    expect(snapshot).not.toBeNull()
    expect(ids(snapshot?.entry.data.authors)).toEqual(VISIBLE)
  })

  it('entry snapshot default populate (no query pattern) applies the same window', async () => {
    const snapshot = await snapshotService.generateEntrySnapshot(db, 'posts', 'post-1', 'en')
    expect(ids(snapshot?.entry.data.authors)).toEqual(VISIBLE)
  })

  it('list snapshot populate applies the same window', async () => {
    const snapshot = await snapshotService.generateListSnapshot(db, 'posts', 'en')
    const post = snapshot?.entries.find((e: { id: string }) => e.id === 'post-1')
    expect(ids(post?.data.authors)).toEqual(VISIBLE)
  })

  it('admin (non-public) populate still returns every related entry', async () => {
    const post = {
      id: 'post-1',
      collectionId: 'col-posts',
      slug: 'post-1',
      status: 'published',
      data: { title: 'Hello' },
      version: 1,
      createdAt: '',
      updatedAt: '',
      publishAt: null,
      unpublishAt: null,
    }
    const populated = await relationsResolver.populate(db, post, ['authors'], 1, 1, new Set(), undefined)
    expect(ids(populated.data.authors).sort()).toEqual(AUTHORS.map((a) => a.id).sort())
  })

  it('reports the nearest upcoming transition of related entries so snapshot TTLs expire before it', async () => {
    const tracker = createPublicVisibility()
    await snapshotService.generateEntrySnapshot(
      db,
      'posts',
      'post-1',
      'en',
      undefined,
      { populate: ['authors'], depth: 1 },
      undefined,
      tracker
    )
    expect(tracker.nearestTransitionAt).toBe(SOON)
  })
})
