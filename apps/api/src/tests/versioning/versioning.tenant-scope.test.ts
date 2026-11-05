import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'
import type { Database } from '@/database/db'
import { createMigratedTestDb } from '../audit/audit-test-db'

/**
 * P2 / CM-06: entry version routes resolve the entry in the request tenant.
 * Real migrated SQLite, real versioning service and repository.
 */
let fixture: ReturnType<typeof createMigratedTestDb>

vi.mock('cloudflare:workers', () => ({ env: { DB: {} } }))
vi.mock('@/database/db', () => ({ createDb: (): Database => fixture.db }))
vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia({ name: 'test-auth' }).macro({
    auth: { derive: () => ({ user: { id: 'user-a' } }) },
  }),
}))

const { versioningController } = await import(
  `../../versioning/versioning.controller?bypass=${Date.now()}`
)

const NOW = '2026-01-01T00:00:00.000Z'

function appFor(tenantId: string | undefined) {
  const app = new Elysia()
  const scoped = tenantId
    ? app.state('tenant', {
        tenant: {
          id: tenantId,
          slug: tenantId,
          name: tenantId,
          status: 'active',
          mediaUploadMaxBytes: 1,
          mediaUploadMaxDimension: 1,
          mediaAllowedMimeTypes: [],
        },
        resources: { mode: 'shared' as const },
      })
    : app
  return scoped.use(versioningController)
}

async function call(tenantId: string | undefined, method: string, path: string) {
  const response = await appFor(tenantId).handle(
    new Request(`http://localhost/api/admin/entries${path}`, { method })
  )
  return { status: response.status, body: (await response.json()) as { success: boolean; data?: unknown } }
}

beforeEach(() => {
  fixture = createMigratedTestDb()
  const fields = JSON.stringify([{ name: 'title', type: 'text', required: false }])
  fixture.sqlite.exec(`
    INSERT INTO tenants (id, slug, name, createdAt, updatedAt) VALUES
      ('tenant-a', 'tenant-a', 'A', '${NOW}', '${NOW}'),
      ('tenant-b', 'tenant-b', 'B', '${NOW}', '${NOW}');
    INSERT INTO collections (id, name, slug, fields, supportedLocales, createdAt, updatedAt, tenantId) VALUES
      ('col-a', 'Posts', 'posts-a', '${fields}', '["en"]', '${NOW}', '${NOW}', 'tenant-a'),
      ('col-b', 'Posts', 'posts-b', '${fields}', '["en"]', '${NOW}', '${NOW}', 'tenant-b'),
      ('col-g', 'Posts', 'posts-g', '${fields}', '["en"]', '${NOW}', '${NOW}', 'global');
  `)
  for (const [entryId, collectionId] of [
    ['entry-a', 'col-a'],
    ['entry-b', 'col-b'],
    ['entry-g', 'col-g'],
  ] as const) {
    fixture.sqlite.exec(`
      INSERT INTO entries (id, collectionId, slug, data, version, createdAt, updatedAt) VALUES
        ('${entryId}', '${collectionId}', '${entryId}', '{"title":"v2"}', 2, '${NOW}', '${NOW}');
      INSERT INTO entry_versions (id, entryId, version, data, createdAt) VALUES
        ('${entryId}-v1', '${entryId}', 1, '{"title":"secret v1 of ${entryId}"}', '${NOW}'),
        ('${entryId}-v2', '${entryId}', 2, '{"title":"v2"}', '${NOW}');
    `)
  }
})

describe('entry version routes are tenant-scoped (P2, CM-06)', () => {
  it('lists, gets and diffs versions of an entry in the request tenant', async () => {
    const list = await call('tenant-a', 'GET', '/entry-a/versions')
    expect(list.status).toBe(200)
    expect((list.body.data as { total: number }).total).toBe(2)

    const one = await call('tenant-a', 'GET', '/entry-a/versions/entry-a-v1')
    expect(one.status).toBe(200)

    const diff = await call('tenant-a', 'GET', '/entry-a/versions/entry-a-v1/diff/entry-a-v2')
    expect(diff.status).toBe(200)
  })

  for (const foreign of ['entry-b', 'entry-g']) {
    it(`does not list, get, diff or roll back ${foreign} from tenant-a`, async () => {
      const list = await call('tenant-a', 'GET', `/${foreign}/versions`)
      expect(list.status).toBe(404)

      const one = await call('tenant-a', 'GET', `/${foreign}/versions/${foreign}-v1`)
      expect(one.status).toBe(404)
      expect(JSON.stringify(one.body)).not.toContain('secret')

      const diff = await call('tenant-a', 'GET', `/${foreign}/versions/${foreign}-v1/diff/${foreign}-v2`)
      expect(diff.status).toBe(404)

      const rollback = await call('tenant-a', 'POST', `/${foreign}/versions/${foreign}-v1/rollback`)
      expect(rollback.status).toBe(404)
      const row = fixture.sqlite.query(`SELECT version FROM entries WHERE id = '${foreign}'`).get()
      expect(row).toEqual({ version: 2 })
    })
  }

  it('rolls back an entry in the request tenant', async () => {
    const rollback = await call('tenant-a', 'POST', '/entry-a/versions/entry-a-v1/rollback')
    expect(rollback.status).toBe(200)
    const row = fixture.sqlite.query(`SELECT version FROM entries WHERE id = 'entry-a'`).get()
    expect(row).toEqual({ version: 3 })
  })

  it('keeps the global (no tenant) route on global entries only', async () => {
    expect((await call(undefined, 'GET', '/entry-g/versions')).status).toBe(200)
    expect((await call(undefined, 'GET', '/entry-a/versions')).status).toBe(404)
  })
})
