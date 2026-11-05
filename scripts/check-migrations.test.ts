import { describe, expect, it } from 'bun:test'
import {
  checkMigrations,
  findDestructiveStatements,
  GRANDFATHERED,
  loadMigrationSets,
  type MigrationFile,
} from './check-migrations'

const NONE = { duplicateNumbers: {}, postgresParityExempt: [], destructive: [] }

function d1(name: string, sql = 'CREATE TABLE "t" ("id" TEXT);'): MigrationFile {
  return { name, sql }
}

function pg(name: string, mirrors: string, sql = 'CREATE TABLE "t" ("id" TEXT);'): MigrationFile {
  return { name, sql: `-- mirrors ../migrations/${mirrors}\n${sql}` }
}

describe('check-migrations: repository', () => {
  it('passes on the migrations in this repository', () => {
    expect(checkMigrations(loadMigrationSets())).toEqual([])
  })

  it('grandfathers only files that exist', () => {
    const { d1: files } = loadMigrationSets()
    const names = new Set(files.map((file) => file.name))
    for (const pair of Object.values(GRANDFATHERED.duplicateNumbers)) {
      for (const name of pair) expect(names.has(name)).toBe(true)
    }
    for (const name of [...GRANDFATHERED.postgresParityExempt, ...GRANDFATHERED.destructive]) {
      expect(names.has(name)).toBe(true)
    }
  })
})

describe('check-migrations: numbering', () => {
  it('fails on a duplicate number unless the exact pair is allowlisted', () => {
    const sets = { d1: [d1('0000_a.sql'), d1('0001_b.sql'), d1('0001_c.sql')], postgres: [] }
    expect(checkMigrations(sets, NONE, 99).join('\n')).toContain('duplicate number 0001')
    const allowed = { ...NONE, duplicateNumbers: { '0001': ['0001_b.sql', '0001_c.sql'] } }
    expect(checkMigrations(sets, allowed, 99)).toEqual([])
  })

  it('fails on a missing number and a malformed name', () => {
    const errors = checkMigrations(
      { d1: [d1('0000_a.sql'), d1('0002_c.sql'), d1('3_bad.sql')], postgres: [] },
      NONE,
      99
    )
    expect(errors.join('\n')).toContain('missing number 0001')
    expect(errors.join('\n')).toContain('3_bad.sql')
  })

  it('checks Postgres numbering too', () => {
    const errors = checkMigrations(
      { d1: [d1('0000_a.sql')], postgres: [pg('0000_a.sql', '0000_a.sql'), pg('0002_b.sql', '0000_a.sql')] },
      NONE,
      99
    )
    expect(errors.join('\n')).toContain('postgres: missing number 0001')
  })
})

describe('check-migrations: Postgres parity', () => {
  it('requires a Postgres mirror for D1 migrations from the parity start', () => {
    const sets = { d1: [d1('0000_a.sql'), d1('0001_b.sql')], postgres: [] }
    expect(checkMigrations(sets, NONE, 1)).toEqual([
      'd1 0001_b.sql: no Postgres counterpart. Add apps/api/drizzle/postgres/NNNN_*.sql with "-- mirrors ../migrations/0001_b.sql", or annotate the D1 file "-- postgres: none <reason>".',
    ])
    expect(
      checkMigrations({ ...sets, postgres: [pg('0000_b.sql', '0001_b.sql')] }, NONE, 1)
    ).toEqual([])
  })

  it('accepts an explicit SQLite-only annotation with a reason', () => {
    const sets = {
      d1: [d1('0000_a.sql'), d1('0001_fts.sql', '-- postgres: none FTS5 is SQLite-only\nSELECT 1;')],
      postgres: [],
    }
    expect(checkMigrations(sets, NONE, 1)).toEqual([])
    const bare = { ...sets, d1: [d1('0000_a.sql'), d1('0001_fts.sql', '-- postgres: none\nSELECT 1;')] }
    expect(checkMigrations(bare, NONE, 1).join('\n')).toContain('needs a reason')
  })

  it('fails on a Postgres mirror that names a missing D1 file', () => {
    const sets = { d1: [d1('0000_a.sql')], postgres: [pg('0000_x.sql', '0009_gone.sql')] }
    expect(checkMigrations(sets, NONE, 99).join('\n')).toContain('mirrors 0009_gone.sql')
  })
})

describe('check-migrations: destructive statements', () => {
  it('detects DROP TABLE, DROP COLUMN, RENAME and DELETE without WHERE', () => {
    const sql = [
      'DROP TABLE "old";',
      'ALTER TABLE "t" DROP COLUMN "c";',
      'ALTER TABLE "t" RENAME TO "u";',
      'ALTER TABLE "t" RENAME COLUMN "a" TO "b";',
      'DELETE FROM "t";',
    ].join('\n--> statement-breakpoint\n')
    expect(findDestructiveStatements(sql).map((hit) => hit.kind)).toEqual([
      'DROP TABLE',
      'DROP COLUMN',
      'RENAME',
      'RENAME',
      'DELETE without WHERE',
    ])
  })

  it('ignores comments, string literals, DROP INDEX, DROP DEFAULT and DELETE with WHERE', () => {
    const sql = [
      '-- DROP TABLE "x";',
      `INSERT INTO "notes" ("body") VALUES ('DROP TABLE users; DELETE FROM t');`,
      'DROP INDEX IF EXISTS "i";',
      'ALTER TABLE "t" ALTER COLUMN "c" DROP DEFAULT;',
      'DELETE FROM "t" WHERE "id" NOT IN (SELECT MIN("id") FROM "t");',
    ].join('\n')
    expect(findDestructiveStatements(sql)).toEqual([])
  })

  it('fails a destructive file without a contract annotation', () => {
    const sets = { d1: [d1('0000_a.sql'), d1('0001_drop.sql', 'DROP TABLE "a";')], postgres: [] }
    expect(checkMigrations(sets, NONE, 99).join('\n')).toContain(
      'd1 0001_drop.sql: DROP TABLE without a "-- contract:" annotation'
    )
  })

  it('accepts a contract annotation naming an earlier expand migration and a backup', () => {
    const body = '-- contract: expands 0000_a.sql; backup: tenant export + d1 time travel bookmark\nDROP TABLE "a";'
    const ok = { d1: [d1('0000_a.sql'), d1('0001_drop.sql', body)], postgres: [] }
    expect(checkMigrations(ok, NONE, 99)).toEqual([])
  })

  it('rejects a contract annotation with no backup, a later or missing expand migration', () => {
    const cases = [
      ['-- contract: expands 0000_a.sql\nDROP TABLE "a";', 'backup'],
      ['-- contract: expands 0005_new.sql; backup: export\nDROP TABLE "a";', '0005_new.sql'],
      ['-- contract: expands 0001_drop.sql; backup: export\nDROP TABLE "a";', 'earlier'],
    ] as const
    for (const [body, message] of cases) {
      const sets = { d1: [d1('0000_a.sql'), d1('0001_drop.sql', body)], postgres: [] }
      expect(checkMigrations(sets, NONE, 99).join('\n')).toContain(message)
    }
  })

  it('applies the same rule to Postgres files', () => {
    const sets = {
      d1: [d1('0000_a.sql')],
      postgres: [pg('0000_a.sql', '0000_a.sql', 'ALTER TABLE "t" DROP COLUMN "c";')],
    }
    expect(checkMigrations(sets, NONE, 99).join('\n')).toContain('postgres 0000_a.sql: DROP COLUMN')
  })

  it('lets a grandfathered file through', () => {
    const sets = { d1: [d1('0000_a.sql', 'DROP TABLE "a";')], postgres: [] }
    expect(checkMigrations(sets, { ...NONE, destructive: ['0000_a.sql'] }, 99)).toEqual([])
  })
})
