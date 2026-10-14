import { describe, expect, it, vi } from 'bun:test'
import { Database as BunSqlite } from 'bun:sqlite'
import { drizzle as drizzleBunSqlite } from 'drizzle-orm/bun-sqlite'
import type { Database } from '@/database/db'

const { entriesRepository } = await import(`../../entries/entries.repository?bypass=${Date.now()}`)
const { collectionsRepository } = await import(
  `../../collections/collections.repository?bypass=${Date.now()}`
)
const { assetsRepository } = await import(`../../assets/assets.repository?bypass=${Date.now()}`)

function createSelectOnlyDb(selectResult: unknown[] = []) {
  const chainBase = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue(selectResult),
  }
  const chain = Object.assign(Promise.resolve(selectResult), chainBase)
  return {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    chainBase,
  }
}

describe('tenant repository isolation', () => {
  it('prevents cross-tenant reads for entries by forcing tenant join checks', async () => {
    const { select, chainBase } = createSelectOnlyDb([])
    const db = { select } as unknown as Database

    const entry = await entriesRepository.findById(db, 'entry-1')

    expect(entry).toBeUndefined()
    expect(chainBase.innerJoin).toHaveBeenCalledTimes(1)
    expect(chainBase.where).toHaveBeenCalledTimes(1)
  })

  it('defaults collection queries to global tenant scope', async () => {
    const { select, chainBase } = createSelectOnlyDb([])
    const db = { select } as unknown as Database

    await collectionsRepository.findAll(db)

    expect(chainBase.where).toHaveBeenCalledTimes(1)
  })

  it('defaults asset writes to global tenant scope when omitted', async () => {
    const values = vi.fn().mockReturnThis()
    const returning = vi.fn().mockResolvedValue([
      {
        id: 'asset-1',
        tenantId: 'global',
      },
    ])
    const db = {
      insert: vi.fn().mockReturnValue({ values, returning }),
    } as unknown as Database

    await assetsRepository.createAsset(db, {
      id: 'asset-1',
      filename: 'hero.png',
      mimeType: 'image/png',
      size: 128,
      originalKey: 'media/hero.png',
      createdAt: '2026-02-17T00:00:00.000Z',
      updatedAt: '2026-02-17T00:00:00.000Z',
    })

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'global',
      })
    )
  })
})

/**
 * BOLA hardening proof against a real SQLite database: tenant-scoped reads
 * must never return rows owned by another tenant, and unscoped (missing
 * tenant) reads must fall back to the 'global' scope instead of leaking
 * every tenant's rows.
 */
describe('tenant isolation against real SQLite', () => {
  const db = createSeededSqliteDb() as unknown as Database

  it('entries findById returns 404-equivalent (undefined) for cross-tenant reads', async () => {
    await expect(entriesRepository.findById(db, 'entry-t1', 't1')).resolves.toMatchObject({
      id: 'entry-t1',
    })
    await expect(entriesRepository.findById(db, 'entry-t1', 't2')).resolves.toBeUndefined()
  })

  it('entries findAll never leaks across tenants (missing tenant reads global only)', async () => {
    const scoped = await entriesRepository.findAll(db, { tenantId: 't1' })
    expect(scoped.rows.map((r: { id: string }) => r.id).sort()).toEqual(['entry-t1'])

    const unscoped = await entriesRepository.findAll(db, {})
    expect(unscoped.rows.map((r: { id: string }) => r.id).sort()).toEqual(['entry-global'])
  })

  it('entries findByIds scopes batch reads (cross-tenant ids excluded)', async () => {
    const crossTenant = await entriesRepository.findByIds(db, ['entry-t1', 'entry-t2'], 't2')
    expect(crossTenant.map((r: { id: string }) => r.id)).toEqual(['entry-t2'])

    const unscoped = await entriesRepository.findByIds(db, ['entry-t1', 'entry-t2'])
    expect(unscoped).toEqual([])
  })

  it('collections reads are tenant-scoped (cross-tenant undefined, missing tenant global)', async () => {
    await expect(collectionsRepository.findById(db, 'col-t1', 't2')).resolves.toBeUndefined()
    await expect(collectionsRepository.findById(db, 'col-t1', 't1')).resolves.toMatchObject({
      id: 'col-t1',
    })
    const unscoped = await collectionsRepository.findAll(db)
    expect(unscoped.map((r: { id: string }) => r.id)).toEqual(['col-global'])
  })

  it('assets findById returns undefined for cross-tenant reads', async () => {
    await expect(assetsRepository.findById(db, 'asset-t1', 't1')).resolves.toMatchObject({
      id: 'asset-t1',
    })
    await expect(assetsRepository.findById(db, 'asset-t1', 't2')).resolves.toBeUndefined()
    const unscoped = await assetsRepository.findAll(db)
    expect(unscoped.map((r: { id: string }) => r.id)).toEqual(['asset-global'])
  })
})

function createSeededSqliteDb() {
  const sqlite = new BunSqlite(':memory:')
  sqlite.exec(`
    CREATE TABLE collections (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL DEFAULT 'global',
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      singleton INTEGER NOT NULL DEFAULT 0,
      fields TEXT NOT NULL,
      defaultLocale TEXT NOT NULL DEFAULT 'en',
      supportedLocales TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      displayName TEXT,
      description TEXT,
      icon TEXT,
      color TEXT,
      listFields TEXT,
      searchFields TEXT,
      defaultSort TEXT,
      defaultSortOrder TEXT
    );
    CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      collectionId TEXT NOT NULL REFERENCES collections(id),
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      data TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      publish_at TEXT,
      unpublish_at TEXT
    );
    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'global',
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      blurhash TEXT,
      created_by TEXT,
      original_key TEXT NOT NULL,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE asset_variants (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL REFERENCES assets(id),
      variant TEXT NOT NULL,
      format TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      file_size INTEGER,
      object_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
  const now = '2026-01-01T00:00:00.000Z'
  const seed = (sql: string) => sqlite.exec(sql)
  for (const [id, tenantId, slug] of [
    ['col-t1', 't1', 'posts-t1'],
    ['col-t2', 't2', 'posts-t2'],
    ['col-global', 'global', 'posts-global'],
  ] as const) {
    seed(
      `INSERT INTO collections (id, tenantId, name, slug, fields, supportedLocales, createdAt, updatedAt) VALUES ('${id}', '${tenantId}', 'Posts', '${slug}', '[]', '["en"]', '${now}', '${now}')`
    )
  }
  for (const [id, collectionId, slug] of [
    ['entry-t1', 'col-t1', 'hello-t1'],
    ['entry-t2', 'col-t2', 'hello-t2'],
    ['entry-global', 'col-global', 'hello-global'],
  ] as const) {
    seed(
      `INSERT INTO entries (id, collectionId, slug, status, data, version, createdAt, updatedAt) VALUES ('${id}', '${collectionId}', '${slug}', 'draft', '{}', 1, '${now}', '${now}')`
    )
  }
  for (const [id, tenantId] of [
    ['asset-t1', 't1'],
    ['asset-t2', 't2'],
    ['asset-global', 'global'],
  ] as const) {
    seed(
      `INSERT INTO assets (id, tenant_id, filename, mime_type, size, original_key, created_at, updated_at) VALUES ('${id}', '${tenantId}', 'img.png', 'image/png', 10, 'media/img.png', '${now}', '${now}')`
    )
  }
  return drizzleBunSqlite(sqlite)
}
