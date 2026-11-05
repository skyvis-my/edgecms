/**
 * OP-05 migration safety check (`bun run check:migrations`).
 *
 * Rules, for `apps/api/drizzle/migrations` (D1) and `apps/api/drizzle/postgres`:
 *
 * 1. Names are `NNNN_snake_name.sql`. Numbers run from 0000 with no gap and no
 *    duplicate. Wrangler applies D1 files by name and records them in
 *    `d1_migrations`; the Drizzle `meta/_journal.json` is not used to apply
 *    and is not checked.
 * 2. Every D1 migration from `POSTGRES_PARITY_FROM` on has a Postgres file
 *    that says `-- mirrors ../migrations/<d1 file>`, or the D1 file says
 *    `-- postgres: none <reason>`. Earlier D1 files are covered by
 *    `postgres/0000_baseline.sql`, which was generated from them.
 * 3. A file with a destructive statement (DROP TABLE, DROP COLUMN,
 *    ALTER TABLE ... RENAME, DELETE without WHERE) must carry
 *    `-- contract: expands <earlier file>; backup: <how data was backed up>`.
 *
 * `GRANDFATHERED` lists the files that predate these rules. Do not add to it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type MigrationFile = { name: string; sql: string }
export type MigrationSets = { d1: MigrationFile[]; postgres: MigrationFile[] }
export type Allowlist = {
  /** Number → the exact file names that share it. */
  duplicateNumbers: Record<string, readonly string[]>
  /** D1 files from the parity start that have no Postgres mirror. */
  postgresParityExempt: readonly string[]
  /** Files (either set) allowed to hold a destructive statement without a contract note. */
  destructive: readonly string[]
}

/** First D1 migration after `postgres/0000_baseline.sql` (baseline holds D1 0000–0037). */
export const POSTGRES_PARITY_FROM = 38

export const GRANDFATHERED: Allowlist = {
  // Two branches merged 0006 before numbers were enforced; both have shipped to D1.
  duplicateNumbers: { '0006': ['0006_blue_manta.sql', '0006_stormy_warbird.sql'] },
  postgresParityExempt: [],
  destructive: [],
}

const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/
const MIRRORS = /^\s*--.*\bmirrors\s+\.\.\/migrations\/(\S+?\.sql)/gim
const POSTGRES_NONE = /^\s*--\s*postgres:\s*none\b(.*)$/im
const CONTRACT = /^\s*--\s*contract:(.*)$/im

const ROOT = join(import.meta.dir, '..')
export const D1_DIR = join(ROOT, 'apps/api/drizzle/migrations')
export const POSTGRES_DIR = join(ROOT, 'apps/api/drizzle/postgres')

function readSqlDir(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}

export function loadMigrationSets(d1Dir = D1_DIR, postgresDir = POSTGRES_DIR): MigrationSets {
  return { d1: readSqlDir(d1Dir), postgres: readSqlDir(postgresDir) }
}

/** SQL with `--` comments and quoted string literals removed. */
function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

export type DestructiveHit = { kind: string; statement: string }

export function findDestructiveStatements(sql: string): DestructiveHit[] {
  const hits: DestructiveHit[] = []
  for (const raw of stripCommentsAndStrings(sql).split(';')) {
    const statement = raw.replace(/\s+/g, ' ').trim()
    if (!statement) continue
    let kind: string | null = null
    if (/\bDROP\s+TABLE\b/i.test(statement)) kind = 'DROP TABLE'
    else if (
      /\bALTER\s+TABLE\b.*\bDROP\s+(?:COLUMN\s+)?(?!CONSTRAINT\b|DEFAULT\b|NOT\s+NULL\b|INDEX\b|IDENTITY\b|EXPRESSION\b)/i.test(
        statement
      )
    )
      kind = 'DROP COLUMN'
    else if (/\bALTER\s+TABLE\b.*\bRENAME\b/i.test(statement)) kind = 'RENAME'
    else if (/\bDELETE\s+FROM\b/i.test(statement) && !/\bWHERE\b/i.test(statement))
      kind = 'DELETE without WHERE'
    if (kind) hits.push({ kind, statement: statement.slice(0, 120) })
  }
  return hits
}

function numberOf(name: string): number | null {
  const match = name.match(NAME)
  return match ? Number(match[1]) : null
}

function checkNumbering(label: string, files: MigrationFile[], allow: Allowlist): string[] {
  const errors: string[] = []
  const byNumber = new Map<number, string[]>()
  for (const { name } of files) {
    const n = numberOf(name)
    if (n === null) {
      errors.push(`${label} ${name}: name must match NNNN_snake_name.sql`)
      continue
    }
    byNumber.set(n, [...(byNumber.get(n) ?? []), name])
  }
  const max = Math.max(-1, ...byNumber.keys())
  for (let n = 0; n <= max; n++) {
    const key = String(n).padStart(4, '0')
    const names = byNumber.get(n)
    if (!names) {
      errors.push(`${label}: missing number ${key}`)
      continue
    }
    if (names.length < 2) continue
    const allowed = allow.duplicateNumbers[key]
    const same =
      allowed && allowed.length === names.length && names.every((name) => allowed.includes(name))
    if (!same) errors.push(`${label}: duplicate number ${key} (${names.join(', ')})`)
  }
  return errors
}

function checkParity(sets: MigrationSets, allow: Allowlist, parityFrom: number): string[] {
  const errors: string[] = []
  const d1Names = new Set(sets.d1.map((file) => file.name))
  const mirrored = new Set<string>()
  for (const file of sets.postgres) {
    for (const match of file.sql.matchAll(MIRRORS)) {
      const target = match[1]!
      mirrored.add(target)
      if (!d1Names.has(target)) {
        errors.push(`postgres ${file.name}: mirrors ${target}, which is not a D1 migration`)
      }
    }
  }
  for (const file of sets.d1) {
    const n = numberOf(file.name)
    if (n === null || n < parityFrom) continue
    if (mirrored.has(file.name) || allow.postgresParityExempt.includes(file.name)) continue
    const none = file.sql.match(POSTGRES_NONE)
    if (none) {
      if (!none[1]!.replace(/^[\s:—-]+/, '').trim()) {
        errors.push(`d1 ${file.name}: "-- postgres: none" needs a reason`)
      }
      continue
    }
    errors.push(
      `d1 ${file.name}: no Postgres counterpart. Add apps/api/drizzle/postgres/NNNN_*.sql with "-- mirrors ../migrations/${file.name}", or annotate the D1 file "-- postgres: none <reason>".`
    )
  }
  return errors
}

function checkContract(
  label: string,
  file: MigrationFile,
  known: Map<string, number>
): string[] {
  const hits = findDestructiveStatements(file.sql)
  if (hits.length === 0) return []
  const note = file.sql.match(CONTRACT)
  const kinds = [...new Set(hits.map((hit) => hit.kind))].join(', ')
  if (!note) {
    return [
      `${label} ${file.name}: ${kinds} without a "-- contract:" annotation. Add "-- contract: expands <earlier migration>; backup: <how the data was backed up>" (see docs/deployment-runbook.md, Migration safety).`,
    ]
  }
  const errors: string[] = []
  const body = note[1]!
  const expand = body.match(/\bexpands\s+(\S+\.sql)/i)?.[1]
  const backup = body.match(/\bbackup:\s*(.+)$/i)?.[1]?.trim()
  if (!expand) {
    errors.push(`${label} ${file.name}: contract annotation must name "expands <migration>.sql"`)
  } else if (!known.has(expand)) {
    errors.push(`${label} ${file.name}: contract expands ${expand}, which does not exist`)
  } else if (known.get(expand)! >= (numberOf(file.name) ?? -1) || expand === file.name) {
    errors.push(`${label} ${file.name}: contract must expand an earlier migration, not ${expand}`)
  }
  if (!backup) errors.push(`${label} ${file.name}: contract annotation needs "backup: <note>"`)
  return errors
}

export function checkMigrations(
  sets: MigrationSets,
  allow: Allowlist = GRANDFATHERED,
  parityFrom = POSTGRES_PARITY_FROM
): string[] {
  const errors = [
    ...checkNumbering('d1', sets.d1, allow),
    ...checkNumbering('postgres', sets.postgres, { ...allow, duplicateNumbers: {} }),
    ...checkParity(sets, allow, parityFrom),
  ]
  for (const [label, files] of [
    ['d1', sets.d1],
    ['postgres', sets.postgres],
  ] as const) {
    const known = new Map(files.map((file) => [file.name, numberOf(file.name) ?? -1]))
    for (const file of files) {
      if (allow.destructive.includes(file.name)) continue
      errors.push(...checkContract(label, file, known))
    }
  }
  return errors
}

if (import.meta.main) {
  const sets = loadMigrationSets()
  const errors = checkMigrations(sets)
  if (errors.length > 0) {
    console.error(errors.join('\n'))
    console.error(`\n${errors.length} migration check error(s). Rules: scripts/check-migrations.ts`)
    process.exit(1)
  }
  console.log(
    `Migration check passed (${sets.d1.length} D1, ${sets.postgres.length} Postgres files)`
  )
}
