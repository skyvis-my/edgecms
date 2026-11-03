import { Database } from 'bun:sqlite'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

type SqlValue = string | number | bigint | boolean | null | Uint8Array

function toSqlValue(value: unknown): SqlValue {
  if (value === undefined) return null
  if (value instanceof Date) return value.getTime()
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return value as SqlValue
}

class SqliteD1Statement {
  constructor(
    private readonly db: Database,
    private readonly sql: string,
    private readonly params: SqlValue[] = []
  ) {}

  bind(...params: unknown[]) {
    return new SqliteD1Statement(this.db, this.sql, params.map(toSqlValue))
  }

  async all<T = Record<string, unknown>>() {
    const results = this.db.query(this.sql).all(...this.params) as T[]
    return { results, success: true, meta: { changes: 0 } }
  }

  async raw<T = unknown[]>() {
    return this.db.query(this.sql).values(...this.params) as T[]
  }

  async first<T = Record<string, unknown>>(column?: string) {
    const row = this.db.query(this.sql).get(...this.params) as Record<string, unknown> | null
    if (!row) return null
    return (column ? row[column] : row) as T
  }

  async run() {
    const result = this.db.query(this.sql).run(...this.params)
    return {
      results: [],
      success: true,
      meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) },
    }
  }
}

export function applySqliteMigrations(sqlite: Database, migrationsDir: string): string[] {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS edgecms_schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
  const applied = new Set(
    (sqlite.query('SELECT id FROM edgecms_schema_migrations').all() as Array<{ id: string }>).map(
      (r) => r.id
    )
  )
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const newly: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    sqlite.exec('BEGIN')
    try {
      for (const statement of sql.split('--> statement-breakpoint')) {
        if (statement.trim()) sqlite.exec(statement)
      }
      sqlite.query('INSERT INTO edgecms_schema_migrations (id, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString()
      )
      sqlite.exec('COMMIT')
      newly.push(file)
    } catch (err) {
      sqlite.exec('ROLLBACK')
      throw err
    }
  }
  return newly
}

/**
 * File-backed D1Database via bun:sqlite — full reuse of drizzle/migrations.
 */
export function createSqliteFileD1(options: {
  path: string
  migrationsDir: string
  applyMigrations?: boolean
}): { d1: D1Database; sqlite: Database; appliedMigrations: string[] } {
  mkdirSync(dirname(options.path), { recursive: true })
  const sqlite = new Database(options.path)
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec('PRAGMA journal_mode = WAL')
  const appliedMigrations =
    options.applyMigrations === false
      ? []
      : applySqliteMigrations(sqlite, options.migrationsDir)

  const d1 = {
    prepare: (sql: string) => new SqliteD1Statement(sqlite, sql),
    batch: async (statements: SqliteD1Statement[]) => {
      const results = []
      sqlite.exec('BEGIN')
      try {
        for (const statement of statements) results.push(await statement.all())
        sqlite.exec('COMMIT')
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
      return results
    },
    exec: async (sql: string) => {
      sqlite.exec(sql)
      return { count: 0, duration: 0 }
    },
  }

  return { d1: d1 as unknown as D1Database, sqlite, appliedMigrations }
}
