import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteFileD1 } from '@/hosting/bindings/sqlite-d1'

describe('createSqliteFileD1', () => {
  it('applies drizzle migrations and supports D1 queries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edgecms-sqlite-'))
    const path = join(dir, 'test.sqlite')
    const migrationsDir = join(import.meta.dir, '../../../drizzle/migrations')
    try {
      const { d1, appliedMigrations, sqlite } = createSqliteFileD1({
        path,
        migrationsDir,
      })
      expect(appliedMigrations.length).toBeGreaterThan(0)

      await d1
        .prepare(
          `INSERT INTO tenants (
            id, slug, name, status, localeCatalog,
            mediaUploadMaxBytes, mediaUploadMaxDimension, mediaAllowedMimeTypes,
            aiEnabled, requireMfa, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          't1',
          'demo',
          'Demo',
          'active',
          JSON.stringify(['en']),
          1024,
          1024,
          JSON.stringify(['image/png']),
          0,
          0,
          new Date().toISOString(),
          new Date().toISOString()
        )
        .run()

      const row = await d1
        .prepare('SELECT slug FROM tenants WHERE id = ?')
        .bind('t1')
        .first<{ slug: string }>()
      expect(row?.slug).toBe('demo')
      sqlite.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
