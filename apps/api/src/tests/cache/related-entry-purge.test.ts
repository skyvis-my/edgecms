/**
 * CM-04 / DL-03 / P5: a cached public snapshot that populates related entries
 * must be retired when one of those related entries changes, not only at TTL.
 *
 * Real engine, handlers, snapshot generation and tag invalidation against
 * SQLite with every migration applied, plus an in-memory KV.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { CommandEnvelope } from '@edgecms/schemas/commands'
import type { CommandContext } from '@/commands/engine'
import { createSqliteD1 } from '../helpers/sqlite-d1'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { createDb } = await import('@/database/db')
const { executeCommand } = await import('@/commands/engine')
const { publicService, MAX_RELATED_ENTRY_CACHE_TAGS, MAX_CACHE_TAG_HEADER_LENGTH } = await import(
  '@/public/public.service'
)
const { kvService } = await import('@/cache/kv.service')
const { extractCacheTagsFromCommand } = await import('@/cache/invalidation.service')

const TENANT = 't-acme'
const actor = { userId: 'u1', source: 'admin' as const }

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

function setup(authorCount = 2) {
  const { d1, sqlite } = createSqliteD1()
  const now = new Date().toISOString()
  sqlite.exec(`
    INSERT INTO tenants (id, slug, name, status, createdAt, updatedAt, localeCatalog, mediaUploadMaxBytes, mediaUploadMaxDimension, mediaAllowedMimeTypes, aiEnabled, requireMfa)
    VALUES ('${TENANT}', 'acme', 'Acme', 'active', '${now}', '${now}', '[]', 1000000, 4000, '[]', 1, 0);
    INSERT INTO collections (id, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt, tenantId)
    VALUES ('col-posts', 'Posts', 'posts', 0, '[{"name":"title","type":"text"},{"name":"authors","type":"relation"}]', 'en', '["en"]', '${now}', '${now}', '${TENANT}');
    INSERT INTO collections (id, name, slug, singleton, fields, defaultLocale, supportedLocales, createdAt, updatedAt, tenantId)
    VALUES ('col-authors', 'Authors', 'authors', 0, '[{"name":"name","type":"text"}]', 'en', '["en"]', '${now}', '${now}', '${TENANT}');
    INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
    VALUES ('post-1', 'col-posts', 'post-1', 'published', '{"title":"Hello"}', 1, '${now}', '${now}');
  `)
  const insertEntry = sqlite.prepare(
    `INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt)
     VALUES (?, 'col-authors', ?, 'published', ?, 1, ?, ?)`
  )
  const insertRelation = sqlite.prepare(
    `INSERT INTO relations (id, sourceEntryId, targetEntryId, sourceCollectionId, targetCollectionId, relationType, fieldName, sortOrder, tenantId, createdAt, updatedAt)
     VALUES (?, 'post-1', ?, 'col-posts', 'col-authors', 'many-to-many', 'authors', ?, ?, ?, ?)`
  )
  for (let i = 1; i <= authorCount; i++) {
    const id = `author-${i}`
    insertEntry.run(id, id, JSON.stringify({ name: id }), now, now)
    insertRelation.run(`rel-${id}`, id, i, TENANT, now, now)
  }
  const kv = createKv()
  const db = createDb(d1)
  const deferred: Promise<unknown>[] = []
  const waitUntil = (p: Promise<unknown>) => {
    deferred.push(p)
  }
  const ctx: CommandContext = {
    db,
    kv,
    actor,
    tenantScope: TENANT,
    syncChannel: TENANT,
  }
  async function readPost() {
    const result = await publicService.getCollectionEntry({
      db,
      kv,
      collectionSlug: 'posts',
      idOrSlug: 'post-1',
      locale: 'en',
      populateParam: 'authors',
      depth: 1,
      tenantId: TENANT,
      waitUntil,
    })
    await Promise.all(deferred.splice(0))
    if (!result.success) throw new Error(result.error.message)
    const payload = result.data.payload as {
      entry: { data: { authors: Array<{ id: string; data: { name: string } }> } }
    }
    return {
      authorIds: payload.entry.data.authors.map((a) => a.id),
      authorNames: payload.entry.data.authors.map((a) => a.data.name),
      cacheTag: result.data.cache.cacheTag,
    }
  }
  return { ctx, readPost }
}

function command(type: string, payload: Record<string, unknown>): CommandEnvelope {
  return { type, payload, actor, timestamp: new Date().toISOString() } as CommandEnvelope
}

describe('related-entry changes purge cached populated snapshots (CM-04/DL-03)', () => {
  beforeEach(() => {
    kvService.__resetInMemorySnapshotCacheForTests()
  })

  it('unpublishing a related entry removes it from the parent cached populated response', async () => {
    const env = setup()
    const first = await env.readPost()
    expect(first.authorIds).toEqual(['author-1', 'author-2'])
    // Second read is served from cache, proving the snapshot is cached.
    const cached = await env.readPost()
    expect(cached.authorIds).toEqual(['author-1', 'author-2'])

    const result = await executeCommand(env.ctx, command('unpublishNow', { entryId: 'author-1' }))
    expect(result.status).toBe('success')

    const after = await env.readPost()
    expect(after.authorIds).toEqual(['author-2'])
  })

  it('updating a related entry refreshes the parent cached populated response', async () => {
    const env = setup()
    await env.readPost()
    const result = await executeCommand(
      env.ctx,
      { ...command('updateEntry', { entryId: 'author-2', data: { name: 'Renamed' } }), optimisticVersion: 1 }
    )
    expect(result.status).toBe('success')
    const after = await env.readPost()
    expect(after.authorNames).toEqual(['author-1', 'Renamed'])
  })

  it('tags the populated response with every related entry and keeps the tags on cache hits', async () => {
    const env = setup()
    const miss = await env.readPost()
    for (const id of ['author-1', 'author-2']) {
      expect(miss.cacheTag.split(',')).toContain(`t:${TENANT}:e:${id}`)
    }
    const hit = await env.readPost()
    expect(hit.cacheTag).toBe(miss.cacheTag)
  })

  it('falls back to a collection-level tag when related entries exceed the cap, and still purges', async () => {
    const env = setup(MAX_RELATED_ENTRY_CACHE_TAGS + 5)
    const miss = await env.readPost()
    const tags = miss.cacheTag.split(',')
    expect(miss.cacheTag.length).toBeLessThanOrEqual(MAX_CACHE_TAG_HEADER_LENGTH)
    expect(tags).toContain(`t:${TENANT}:c:col-authors`)
    expect(tags.some((t) => t.includes(':e:author-'))).toBe(false)

    const result = await executeCommand(env.ctx, command('unpublishNow', { entryId: 'author-3' }))
    expect(result.status).toBe('success')
    const after = await env.readPost()
    expect(after.authorIds).not.toContain('author-3')
    expect(after.authorIds).toHaveLength(MAX_RELATED_ENTRY_CACHE_TAGS + 4)
  })
})

describe('related-entry deletes purge cached populated snapshots (CM-04/DL-03)', () => {
  beforeEach(() => {
    kvService.__resetInMemorySnapshotCacheForTests()
  })

  it('deleting a related entry removes it from the parent cached populated response', async () => {
    const env = setup()
    await env.readPost()
    const result = await executeCommand(env.ctx, command('deleteEntry', { entryId: 'author-1' }))
    expect(result.status).toBe('success')
    const after = await env.readPost()
    expect(after.authorIds).toEqual(['author-2'])
  })

  it('deleting a related entry purges via the collection fallback tag above the cap', async () => {
    const env = setup(MAX_RELATED_ENTRY_CACHE_TAGS + 5)
    await env.readPost()
    const result = await executeCommand(env.ctx, command('deleteEntry', { entryId: 'author-3' }))
    expect(result.status).toBe('success')
    const after = await env.readPost()
    expect(after.authorIds).not.toContain('author-3')
  })

  it('unlinkRelation emits the tenant-scoped entry tag that populated snapshots carry', async () => {
    const env = setup()
    await env.readPost()
    const tags = await extractCacheTagsFromCommand(
      env.ctx.db,
      'unlinkRelation',
      { sourceEntryId: 'author-1', targetEntryId: 'x' },
      TENANT
    )
    expect(tags).toContain(`t:${TENANT}:e:author-1`)
  })
})
