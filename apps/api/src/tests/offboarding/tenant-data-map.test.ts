import { describe, expect, it } from 'bun:test'
import { getTableName, is } from 'drizzle-orm'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from '@/database/schema'
import {
  TENANT_DELETION_ORDER,
  TENANT_TABLE_RULES,
  TENANT_UNSCOPED_TABLES,
} from '@/offboarding/tenant-data-map'
import { createMigratedTestDb } from '../audit/audit-test-db'

const TENANT_COLUMN = /^tenant(_?id|_?scope)$/i

type SqliteMasterRow = { name: string; sql: string | null }

/** Every real table created by the migrations (FTS shadow and SQLite internals excluded). */
function migratedTables() {
  const { sqlite } = createMigratedTestDb()
  const rows = sqlite
    .query(`SELECT name, sql FROM sqlite_master WHERE type = 'table'`)
    .all() as SqliteMasterRow[]
  const virtualTables = rows
    .filter((row) => /^CREATE VIRTUAL TABLE/i.test(row.sql ?? ''))
    .map((row) => row.name)
  const tables = rows
    .map((row) => row.name)
    .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_cf_'))
    .filter((name) => name !== 'd1_migrations')
    .filter((name) => !virtualTables.some((v) => name.startsWith(`${v}_`)))
  const columns = (table: string) =>
    (sqlite.query(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[]).map(
      (c) => c.name
    )
  const foreignKeys = (table: string) =>
    sqlite.query(`SELECT "table" AS parent FROM pragma_foreign_key_list(?)`).all(table) as {
      parent: string
    }[]
  return { tables, columns, foreignKeys }
}

describe('HS-09 tenant data map', () => {
  it('classifies every table the migrations create', () => {
    const { tables } = migratedTables()
    const classified = new Set(TENANT_TABLE_RULES.map((rule) => rule.table))
    const missing = tables.filter((table) => !classified.has(table))
    // A new table must be added to TENANT_DELETION_ORDER or TENANT_UNSCOPED_TABLES.
    expect(missing).toEqual([])
  })

  it('classifies every table in the Drizzle schema', () => {
    const classified = new Set(TENANT_TABLE_RULES.map((rule) => rule.table))
    const drizzleTables = Object.values(schema)
      .filter((value) => is(value, SQLiteTable))
      .map((table) => getTableName(table as SQLiteTable))
    expect(drizzleTables.filter((table) => !classified.has(table))).toEqual([])
  })

  it('lists no table twice and no table that does not exist', () => {
    const { tables } = migratedTables()
    const names = TENANT_TABLE_RULES.map((rule) => rule.table)
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter((name) => !tables.includes(name))).toEqual([])
  })

  it('never treats a table with a tenant column as global', () => {
    const { columns } = migratedTables()
    const global = TENANT_UNSCOPED_TABLES.filter((rule) => rule.kind === 'global')
    for (const rule of global) {
      expect({ table: rule.table, tenantColumns: columns(rule.table).filter((c) => TENANT_COLUMN.test(c)) })
        .toEqual({ table: rule.table, tenantColumns: [] })
    }
  })

  it('scopes tenant tables by a column that exists', () => {
    const { columns } = migratedTables()
    for (const rule of TENANT_DELETION_ORDER) {
      if (rule.kind === 'tenant' || rule.kind === 'child') {
        expect({ table: rule.table, has: columns(rule.table).includes(rule.column) }).toEqual({
          table: rule.table,
          has: true,
        })
      }
      if (rule.kind === 'child') {
        expect(columns(rule.parent)).toContain(rule.parentColumn)
      }
    }
  })

  it('scopes every table that has a tenant column directly by it', () => {
    const { tables, columns } = migratedTables()
    const byTable = new Map(TENANT_TABLE_RULES.map((rule) => [rule.table, rule]))
    for (const table of tables) {
      const tenantColumns = columns(table).filter((c) => TENANT_COLUMN.test(c))
      if (tenantColumns.length === 0) continue
      const rule = byTable.get(table)
      expect({ table, kind: rule?.kind }).not.toEqual({ table, kind: 'global' })
      if (rule?.kind === 'tenant') expect(tenantColumns).toContain(rule.column)
    }
  })

  it('deletes children before the parents they reference', () => {
    const { foreignKeys } = migratedTables()
    const position = new Map(TENANT_DELETION_ORDER.map((rule, index) => [rule.table, index]))
    for (const rule of TENANT_DELETION_ORDER) {
      if (rule.kind === 'child') {
        expect(position.get(rule.parent)!).toBeGreaterThan(position.get(rule.table)!)
      }
      for (const { parent } of foreignKeys(rule.table)) {
        if (!position.has(parent)) continue
        expect({ child: rule.table, parent, before: position.get(rule.table)! < position.get(parent)! })
          .toEqual({ child: rule.table, parent, before: true })
      }
    }
    expect(TENANT_DELETION_ORDER[TENANT_DELETION_ORDER.length - 1]?.kind).toBe('root')
  })
})
