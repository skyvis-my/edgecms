import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS_DIR = join(import.meta.dir, '../../../drizzle/migrations')

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

/**
 * Minimal D1Database backed by in-memory bun:sqlite with every migration in
 * `drizzle/migrations` applied. For integration tests that need real SQL
 * (for example a real better-auth instance), not a Workers runtime.
 */
export function createSqliteD1(): { d1: D1Database; sqlite: Database } {
  const sqlite = new Database(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement)
    }
  }

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

  return { d1: d1 as unknown as D1Database, sqlite }
}
