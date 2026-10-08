import { describe, expect, it } from 'bun:test'

const { parsePublicFilters, hashFilterParams } = await import(
  `../public/query-filter?bypass=${Date.now()}`
)

describe('parsePublicFilters', () => {
  it('returns empty filters when no query params', () => {
    const result = parsePublicFilters({})
    expect(result.sort).toEqual([])
    expect(result.filters).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('parses sort parameter', () => {
    const result = parsePublicFilters({ sort: 'createdAt' })
    expect(result.sort).toEqual([{ field: 'createdAt', order: 'asc' }])
  })

  it('parses sort with desc prefix', () => {
    const result = parsePublicFilters({ sort: '-updatedAt' })
    expect(result.sort).toEqual([{ field: 'updatedAt', order: 'desc' }])
  })

  it('rejects sort on disallowed fields', () => {
    const result = parsePublicFilters({ sort: 'id' })
    expect(result.sort).toEqual([])
    expect(result.errors).toEqual([
      'Field "id" is not sortable. Allowed top-level fields: createdAt, updatedAt, slug. Use data.fieldName for custom fields.',
    ])
  })

  it('returns combined sort and filter validation errors', () => {
    const result = parsePublicFilters({
      sort: 'unknown',
      'filter[status][invalid_op]': 'draft',
      'filter[title][eq]': 'x',
    })

    expect(result.filters).toEqual([])
    expect(result.sort).toEqual([])
    expect(result.errors).toEqual([
      'Field "unknown" is not sortable. Allowed top-level fields: createdAt, updatedAt, slug. Use data.fieldName for custom fields.',
      'Invalid operator "invalid_op" for field "status". Valid: eq, neq, gt, gte, lt, lte, contains, in, not_in, exists',
      'Field "title" is not filterable. Allowed top-level fields: slug, createdAt, updatedAt, status. Use data.fieldName for custom fields.',
    ])
  })

  it('parses published status filter as equals', () => {
    const result = parsePublicFilters({ 'filter[status]': 'published' })
    expect(result.filters).toEqual([
      { field: 'status', operator: 'eq', value: 'published' },
    ])
  })

  it('rejects public status filters that could expose drafts', () => {
    const result = parsePublicFilters({ 'filter[status]': 'draft' })
    expect(result.filters).toEqual([])
    expect(result.errors).toEqual([
      'Public status filters only support published content.',
    ])
  })

  it('parses filter[field][operator]=value', () => {
    const result = parsePublicFilters({ 'filter[data.price][gte]': '100' })
    expect(result.filters).toEqual([
      { field: 'data.price', operator: 'gte', value: '100' },
    ])
  })

  it('parses filter[field][in] as comma-separated list', () => {
    const result = parsePublicFilters({ 'filter[data.category][in]': 'tech,science' })
    expect(result.filters).toEqual([
      { field: 'data.category', operator: 'in', value: ['tech', 'science'] },
    ])
  })

  it('rejects unsupported operators', () => {
    const result = parsePublicFilters({ 'filter[data.x][nope]': 'val' })
    expect(result.filters).toEqual([])
  })

  it('limits to 10 filter conditions', () => {
    const params: Record<string, string> = {}
    for (let i = 0; i < 15; i++) {
      params[`filter[data.f${i}]`] = `v${i}`
    }
    const result = parsePublicFilters(params)
    expect(result.filters.length).toBe(10)
    expect(result.errors).toEqual(['Too many filter conditions. Max: 10'])
  })

  it('returns sort errors even when filter limit is hit', () => {
    const params: Record<string, string> = { sort: 'unknown' }
    for (let i = 0; i < 12; i++) {
      params[`filter[data.f${i}]`] = `v${i}`
    }

    const result = parsePublicFilters(params)

    expect(result.filters.length).toBe(10)
    expect(result.errors).toEqual([
      'Field "unknown" is not sortable. Allowed top-level fields: createdAt, updatedAt, slug. Use data.fieldName for custom fields.',
      'Too many filter conditions. Max: 10',
    ])
  })

  it('rejects malformed custom field paths', () => {
    const result = parsePublicFilters({
      'filter[data.]': 'empty',
      'filter[data.title.*]': 'wildcard',
      sort: '-data.',
    })
    expect(result.filters).toEqual([])
    expect(result.sort).toEqual([])
    expect(result.errors).toEqual([
      'Field "data." is not sortable. Allowed top-level fields: createdAt, updatedAt, slug. Use data.fieldName for custom fields.',
      'Field "data." is not filterable. Allowed top-level fields: slug, createdAt, updatedAt, status. Use data.fieldName for custom fields.',
      'Field "data.title.*" is not filterable. Allowed top-level fields: slug, createdAt, updatedAt, status. Use data.fieldName for custom fields.',
    ])
  })

  it('rejects empty in/not_in filter values', () => {
    const result = parsePublicFilters({
      'filter[data.category][in]': ', ,',
      'filter[status][not_in]': '',
    })
    expect(result.filters).toEqual([])
    expect(result.errors).toEqual([
      'Filter "data.category" with operator "in" must include at least one value',
    ])
  })
})

describe('hashFilterParams', () => {
  it('returns stable hash for same filters', () => {
    const filters = [{ field: 'data.status', operator: 'eq' as const, value: 'active' }]
    const sort = [{ field: 'createdAt', order: 'desc' as const }]
    const hash1 = hashFilterParams(filters, sort)
    const hash2 = hashFilterParams(filters, sort)
    expect(hash1).toBe(hash2)
  })

  it('returns "none" for empty filters and no sort', () => {
    expect(hashFilterParams([], [])).toBe('none')
  })

  it('returns different hashes for different filters', () => {
    const hash1 = hashFilterParams(
      [{ field: 'data.a', operator: 'eq' as const, value: 'x' }],
      []
    )
    const hash2 = hashFilterParams(
      [{ field: 'data.b', operator: 'eq' as const, value: 'y' }],
      []
    )
    expect(hash1).not.toBe(hash2)
  })
})

const { buildDrizzleConditions } = await import(
  `../public/query-filter?bypass=${Date.now() + 1}`
)

describe('buildDrizzleConditions', () => {
  it('builds NOT IN condition for not_in operator', () => {
    const filters = [
      { field: 'status', operator: 'not_in' as const, value: ['draft', 'archived'] },
    ]
    const conditions = buildDrizzleConditions(filters)
    expect(conditions).toHaveLength(1)
  })

  it('rejects not_in status filter from query string', () => {
    const { parsePublicFilters } = require(`../public/query-filter?bypass=${Date.now() + 2}`)
    const result = parsePublicFilters({
      'filter[status][not_in]': 'draft,archived',
    })
    expect(result.filters).toEqual([])
    expect(result.errors).toEqual(['Public status filters only support published content.'])
  })

  it('builds IS NOT NULL condition for exists=true', () => {
    const filters = [
      { field: 'data.subtitle', operator: 'exists' as const, value: 'true' },
    ]
    const conditions = buildDrizzleConditions(filters)
    expect(conditions).toHaveLength(1)
  })

  it('builds IS NULL condition for exists=false', () => {
    const filters = [
      { field: 'data.subtitle', operator: 'exists' as const, value: 'false' },
    ]
    const conditions = buildDrizzleConditions(filters)
    expect(conditions).toHaveLength(1)
  })

  it('parses exists filter from query string', () => {
    const { parsePublicFilters } = require(`../public/query-filter?bypass=${Date.now() + 3}`)
    const result = parsePublicFilters({
      'filter[data.subtitle][exists]': 'true',
    })
    expect(result.filters).toEqual([
      { field: 'data.subtitle', operator: 'exists', value: 'true' },
    ])
  })

  it('parses comma-separated multi-field sort', () => {
    const { parsePublicFilters } = require(`../public/query-filter?bypass=${Date.now() + 4}`)
    const result = parsePublicFilters({ sort: '-createdAt,slug' })
    expect(result.sort).toEqual([
      { field: 'createdAt', order: 'desc' },
      { field: 'slug', order: 'asc' },
    ])
  })

  it('builds multi-field ORDER BY clause', () => {
    const { buildSortClause } = require(`../public/query-filter?bypass=${Date.now() + 5}`)
    const sort = [
      { field: 'createdAt', order: 'desc' as const },
      { field: 'slug', order: 'asc' as const },
    ]
    const clause = buildSortClause(sort)
    expect(clause).toBeDefined()
  })

  it('hashes multi-sort for cache key', () => {
    const { hashFilterParams } = require(`../public/query-filter?bypass=${Date.now() + 6}`)
    const sort = [
      { field: 'createdAt', order: 'desc' as const },
      { field: 'slug', order: 'asc' as const },
    ]
    const hash = hashFilterParams([], sort)
    expect(hash).not.toBe('none')
  })

  it('returns validation errors for invalid filter operator', () => {
    const { parsePublicFilters } = require(`../public/query-filter?bypass=${Date.now() + 7}`)
    const result = parsePublicFilters({
      'filter[status][invalid_op]': 'draft',
    })
    expect(result.errors).toEqual([
      'Invalid operator "invalid_op" for field "status". Valid: eq, neq, gt, gte, lt, lte, contains, in, not_in, exists',
    ])
    expect(result.filters).toEqual([])
  })

  it('returns validation errors for disallowed filter field', () => {
    const { parsePublicFilters } = require(`../public/query-filter?bypass=${Date.now() + 8}`)
    const result = parsePublicFilters({
      'filter[id][eq]': 'abc',
    })
    expect(result.errors).toEqual([
      'Field "id" is not filterable. Allowed top-level fields: slug, createdAt, updatedAt, status. Use data.fieldName for custom fields.',
    ])
  })
})
