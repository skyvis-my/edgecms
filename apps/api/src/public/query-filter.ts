import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { entries } from '@/database/schema'

const VALID_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'not_in', 'exists'] as const
type FilterOperator = (typeof VALID_OPERATORS)[number]

const SORTABLE_FIELDS = new Set(['createdAt', 'updatedAt', 'slug'])
const FILTERABLE_TOP_LEVEL = new Set(['slug', 'createdAt', 'updatedAt', 'status'])
const MAX_FILTERS = 10

const FILTER_KEY_REGEX = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/
const DATA_FIELD_REGEX = /^data\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/
// Perf guard: LIKE '%...%' scans are expensive — cap value length and IN list size.
const MAX_VALUE_LEN = 100
const MAX_IN_VALUES = 50

export type ParsedFilter = {
  field: string
  operator: FilterOperator
  value: string | string[]
}

export type ParsedSort = {
  field: string
  order: 'asc' | 'desc'
}

export type ParsedPublicQuery = {
  filters: ParsedFilter[]
  sort: ParsedSort[]
  errors: string[]
}

export function parsePublicFilters(
  query: Record<string, string | undefined>
): ParsedPublicQuery {
  const filters: ParsedFilter[] = []
  const errors: string[] = []

  const sortParam = query.sort
  const sort: ParsedSort[] = []
  if (sortParam) {
    const sortFields = sortParam.split(',').map((s) => s.trim())
    for (const sortField of sortFields) {
      if (!sortField) continue
      const isDesc = sortField.startsWith('-')
      const field = isDesc ? sortField.slice(1) : sortField
      // Note: data.* sorts force temp-btree scans (kept allowed for compat;
      // callers should prefer indexed top-level sorts). No error here.
      if (isAllowedSortField(field)) {
        sort.push({ field, order: isDesc ? 'desc' : 'asc' })
      } else {
        errors.push(
          `Field "${field}" is not sortable. Allowed top-level fields: ${[...SORTABLE_FIELDS].join(', ')}. Use data.fieldName for custom fields.`
        )
      }
    }
  }

  for (const [key, rawValue] of Object.entries(query)) {
    if (!rawValue) continue

    const match = FILTER_KEY_REGEX.exec(key)
    if (!match) continue

    if (filters.length >= MAX_FILTERS) {
      errors.push(`Too many filter conditions. Max: ${MAX_FILTERS}`)
      break
    }

    const field = match[1]!
    const operatorStr = match[2] ?? 'eq'

    if (!isValidOperator(operatorStr)) {
      errors.push(
        `Invalid operator "${operatorStr}" for field "${field}". Valid: ${VALID_OPERATORS.join(', ')}`
      )
      continue
    }
    if (!isAllowedFilterField(field)) {
      errors.push(
        `Field "${field}" is not filterable. Allowed top-level fields: ${[...FILTERABLE_TOP_LEVEL].join(', ')}. Use data.fieldName for custom fields.`
      )
      continue
    }
    // Note: data.* JSON extracts cannot use indexes; abuse is bounded by
    // MAX_VALUE_LEN / MAX_IN_VALUES / MAX_FILTERS. Expensive shapes
    // (contains LIKE scans, JSON sorts) are additionally gated per collection
    // via enforceSearchAllowlist (see below) on the public read path.

    const value =
      operatorStr === 'in' || operatorStr === 'not_in'
        ? rawValue
            .split(',')
            .map((v) => v.trim())
            .filter((v) => v.length > 0)
        : rawValue

    if ((operatorStr === 'in' || operatorStr === 'not_in') && value.length === 0) {
      errors.push(`Filter "${field}" with operator "${operatorStr}" must include at least one value`)
      continue
    }
    // Cap IN lists to avoid oversized SQL.
    if ((operatorStr === 'in' || operatorStr === 'not_in') && (value as string[]).length > MAX_IN_VALUES) {
      errors.push(`Filter "${field}" accepts at most ${MAX_IN_VALUES} values`)
      continue
    }
    // Disallow long contains values (esp. on data.* JSON extracts which can't use indexes);
    // fall back guidance: use eq or shorten the value.
    if (operatorStr === 'contains' && typeof rawValue === 'string' && rawValue.length > MAX_VALUE_LEN) {
      errors.push(
        `Filter "${field}" with operator "contains" exceeds max length ${MAX_VALUE_LEN}; use "eq" or a shorter value`
      )
      continue
    }
    if (field === 'status' && !isPublishedStatusFilter(operatorStr, value)) {
      errors.push('Public status filters only support published content.')
      continue
    }

    filters.push({ field, operator: operatorStr, value })
  }

  return { filters, sort, errors }
}

export type EnforcedPublicQuery = {
  filters: ParsedFilter[]
  sort: ParsedSort[]
  errors: string[]
}

/** Top-level segment of a `data.a.b.c` path (the declared field name). */
function dataRootField(field: string): string {
  return field.slice(5).split('.')[0] ?? ''
}

/**
 * Enforce a collection's `searchFields` allowlist on the expensive query
 * shapes: `contains` (LIKE `%…%` full scan) and `data.*` sorts (temp-btree
 * scans over json_extract).
 *
 * - `searchFields == null` (never configured): passthrough for compat.
 * - Otherwise only allowlisted root fields may use `contains` or be sorted.
 *   Rejected filters/sorts are dropped and reported in `errors`.
 * - All other operators on `data.*` (eq, in, …) stay allowed; abuse is still
 *   bounded by MAX_VALUE_LEN / MAX_IN_VALUES / MAX_FILTERS.
 */
export function enforceSearchAllowlist(
  filters: ParsedFilter[],
  sort: ParsedSort[],
  searchFields: string[] | null | undefined
): EnforcedPublicQuery {
  if (searchFields == null) {
    return { filters, sort, errors: [] }
  }
  const allowed = new Set(searchFields)
  const errors: string[] = []
  const keptFilters = filters.filter((filter) => {
    if (filter.field.startsWith('data.') && filter.operator === 'contains') {
      if (!allowed.has(dataRootField(filter.field))) {
        errors.push(
          `Filter "${filter.field}" with operator "contains" is not searchable on this collection`
        )
        return false
      }
    }
    return true
  })
  const keptSort = sort.filter((s) => {
    if (s.field.startsWith('data.') && !allowed.has(dataRootField(s.field))) {
      errors.push(`Field "${s.field}" is not sortable on this collection`)
      return false
    }
    return true
  })
  return { filters: keptFilters, sort: keptSort, errors }
}

export function hashFilterParams(
  filters: ParsedFilter[],
  sort: ParsedSort[]
): string {
  if (filters.length === 0 && sort.length === 0) return 'none'

  const canonical = JSON.stringify({ f: filters, s: sort })
  let hash = 0
  for (let i = 0; i < canonical.length; i++) {
    const char = canonical.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return `q${Math.abs(hash).toString(36)}`
}

const TOP_LEVEL_COLUMNS: Record<string, typeof entries.slug | typeof entries.createdAt | typeof entries.updatedAt | typeof entries.status> = {
  slug: entries.slug,
  createdAt: entries.createdAt,
  updatedAt: entries.updatedAt,
  status: entries.status,
}

export function buildDrizzleConditions(filters: ParsedFilter[]): SQL[] {
  const conditions: SQL[] = []

  for (const filter of filters) {
    const condition = buildSingleCondition(filter)
    if (condition) conditions.push(condition)
  }

  return conditions
}

export function buildSortClause(sort: ParsedSort[]): SQL | undefined {
  if (sort.length === 0) return undefined

  const clauses: SQL[] = []
  for (const s of sort) {
    if (s.field.startsWith('data.')) {
      const jsonPath = `$.${s.field.slice(5)}`
      const extract = sql`json_extract(${entries.data}, ${jsonPath})`
      clauses.push(s.order === 'desc' ? sql`${extract} DESC` : sql`${extract} ASC`)
    } else {
      const column = TOP_LEVEL_COLUMNS[s.field]
      if (column) {
        clauses.push(s.order === 'desc' ? sql`${column} DESC` : sql`${column} ASC`)
      }
    }
  }

  if (clauses.length === 0) return undefined
  return sql.join(clauses, sql`, `)
}

function buildSingleCondition(filter: ParsedFilter): SQL | null {
  const { field, operator, value } = filter

  if (field.startsWith('data.')) {
    const jsonPath = `$.${field.slice(5)}`
    const extract = sql`json_extract(${entries.data}, ${jsonPath})`
    return applyOperator(extract, operator, value)
  }

  const column = TOP_LEVEL_COLUMNS[field]
  if (!column) return null
  return applyOperator(sql`${column}`, operator, value)
}

function applyOperator(
  column: SQL,
  operator: FilterOperator,
  value: string | string[]
): SQL | null {
  const v = Array.isArray(value) ? value : value
  switch (operator) {
    case 'eq':
      return sql`${column} = ${v as string}`
    case 'neq':
      return sql`${column} != ${v as string}`
    case 'gt':
      return sql`${column} > ${v as string}`
    case 'gte':
      return sql`${column} >= ${v as string}`
    case 'lt':
      return sql`${column} < ${v as string}`
    case 'lte':
      return sql`${column} <= ${v as string}`
    case 'contains': {
      // Truncate defensive cap (parse already rejects > MAX_VALUE_LEN).
      const needle = String(v).slice(0, MAX_VALUE_LEN)
      return sql`${column} LIKE ${'%' + needle + '%'}`
    }
    case 'in': {
      if (!Array.isArray(value) || value.length === 0) return null
      const capped = value.slice(0, MAX_IN_VALUES)
      const placeholders = capped.map((val) => sql`${val}`)
      return sql`${column} IN (${sql.join(placeholders, sql`, `)})`
    }
    case 'not_in': {
      if (!Array.isArray(value) || value.length === 0) return null
      const capped = value.slice(0, MAX_IN_VALUES)
      const placeholders = capped.map((val) => sql`${val}`)
      return sql`${column} NOT IN (${sql.join(placeholders, sql`, `)})`
    }
    case 'exists': {
      const isExists = (value as string) === 'true'
      return isExists ? sql`${column} IS NOT NULL` : sql`${column} IS NULL`
    }
    default:
      return null
  }
}

function isValidOperator(op: string): op is FilterOperator {
  return (VALID_OPERATORS as readonly string[]).includes(op)
}

function isAllowedFilterField(field: string): boolean {
  if (field.startsWith('data.')) return DATA_FIELD_REGEX.test(field)
  return FILTERABLE_TOP_LEVEL.has(field)
}

function isAllowedSortField(field: string): boolean {
  if (field.startsWith('data.')) return DATA_FIELD_REGEX.test(field)
  return SORTABLE_FIELDS.has(field)
}

function isPublishedStatusFilter(
  operator: FilterOperator,
  value: string | string[]
): boolean {
  if (operator === 'eq') return value === 'published'
  if (operator === 'in') return Array.isArray(value) && value.length === 1 && value[0] === 'published'
  return false
}
