import { readFileSync } from 'node:fs'
import { Database as BunSqlite } from 'bun:sqlite'
import { drizzle as drizzleBunSqlite } from 'drizzle-orm/bun-sqlite'
import type { Database } from '@/database/db'

const AUDIT_MIGRATION = new URL('../../../drizzle/migrations/0032_audit_events.sql', import.meta.url)

/** Real SQLite with the audit ledger table plus tenant memberships. */
export function createAuditTestDb() {
  const sqlite = new BunSqlite(':memory:')
  sqlite.exec(readFileSync(AUDIT_MIGRATION, 'utf8'))
  sqlite.exec(`CREATE TABLE "tenant_users" (
    "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TEXT NOT NULL, PRIMARY KEY ("tenantId", "userId"))`)
  const db = drizzleBunSqlite(sqlite) as unknown as Database
  return { sqlite, db }
}
