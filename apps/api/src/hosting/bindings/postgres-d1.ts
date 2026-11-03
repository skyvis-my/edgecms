import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

type SqlValue = string | number | bigint | boolean | null | Uint8Array | Date

function toSqlValue(value: unknown): SqlValue {
  if (value === undefined) return null
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return value as SqlValue
}

/**
 * Translate SQLite-style `?` placeholders to Postgres `$1..$n`.
 * Does not rewrite SQL dialect beyond placeholders — migrations must be Postgres SQL.
 */
export function sqlitePlaceholdersToPostgres(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => {
    index += 1
    return `$${index}`
  })
}

class PostgresD1Statement {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly rawSql: string,
    private readonly params: SqlValue[] = []
  ) {}

  bind(...params: unknown[]) {
    return new PostgresD1Statement(this.sql, this.rawSql, params.map(toSqlValue))
  }

  private translated() {
    return sqlitePlaceholdersToPostgres(this.rawSql)
  }

  async all<T = Record<string, unknown>>() {
    const rows = await this.sql.unsafe(this.translated(), this.params as never[])
    return { results: rows as unknown as T[], success: true, meta: { changes: 0 } }
  }

  async raw<T = unknown[]>() {
    const rows = await this.sql.unsafe(this.translated(), this.params as never[])
    return (rows as unknown as Record<string, unknown>[]).map((row) => Object.values(row)) as T[]
  }

  async first<T = Record<string, unknown>>(column?: string) {
    const rows = await this.sql.unsafe(this.translated(), this.params as never[])
    const row = (rows as unknown as Record<string, unknown>[])[0]
    if (!row) return null
    return (column ? row[column] : row) as T
  }

  async run() {
    const result = await this.sql.unsafe(this.translated(), this.params as never[])
    const count = typeof (result as { count?: number }).count === 'number'
      ? (result as { count: number }).count
      : Array.isArray(result)
        ? result.length
        : 0
    return {
      results: [],
      success: true,
      meta: { changes: count, last_row_id: 0 },
    }
  }
}

export async function applyPostgresMigrations(
  sql: postgres.Sql,
  migrationsDir: string
): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS edgecms_schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  const appliedRows = await sql<{ id: string }[]>`SELECT id FROM edgecms_schema_migrations`
  const applied = new Set(appliedRows.map((r) => r.id))
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const newly: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const body = readFileSync(join(migrationsDir, file), 'utf8')
    await sql.begin(async (tx) => {
      for (const statement of body
        .split(/-->\s*statement-breakpoint/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        // Skip pure comment / banner blocks
        const withoutComments = statement
          .split('\n')
          .filter((line) => !/^\s*--/.test(line))
          .join('\n')
          .trim()
        if (!withoutComments) continue
        await tx.unsafe(withoutComments.endsWith(';') ? withoutComments : `${withoutComments};`)
      }
      await tx`INSERT INTO edgecms_schema_migrations (id, applied_at) VALUES (${file}, NOW())`
    })
    newly.push(file)
  }
  return newly
}

export type PostgresD1Handle = {
  d1: D1Database
  sql: postgres.Sql
  appliedMigrations: string[]
  close: () => Promise<void>
}

/**
 * D1Database facade over Postgres so existing `drizzle-orm/d1` repositories keep working.
 * Requires Postgres-dialect migrations under `drizzle/postgres/`.
 */
export async function createPostgresD1(options: {
  databaseUrl: string
  migrationsDir: string
  applyMigrations?: boolean
}): Promise<PostgresD1Handle> {
  const sql = postgres(options.databaseUrl, {
    max: 10,
    prepare: false,
  })
  const appliedMigrations =
    options.applyMigrations === false
      ? []
      : await applyPostgresMigrations(sql, options.migrationsDir)

  const d1 = {
    prepare: (query: string) => new PostgresD1Statement(sql, query),
    batch: async (statements: PostgresD1Statement[]) => {
      return sql.begin(async () => {
        const results = []
        for (const statement of statements) results.push(await statement.all())
        return results
      })
    },
    exec: async (query: string) => {
      await sql.unsafe(query)
      return { count: 0, duration: 0 }
    },
  }

  return {
    d1: d1 as unknown as D1Database,
    sql,
    appliedMigrations,
    close: async () => {
      await sql.end({ timeout: 5 })
    },
  }
}
