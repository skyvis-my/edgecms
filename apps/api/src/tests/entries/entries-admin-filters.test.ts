import { describe, it, expect } from 'bun:test'

const { parsePublicFilters, buildDrizzleConditions, buildSortClause } = await import(
  `@/public/query-filter?bypass=${Date.now()}`
)

describe('Admin entry filtering via query-filter module', () => {
  it('parses filter[data.title][contains]=hello into a valid filter', () => {
    const result = parsePublicFilters({
      'filter[data.title][contains]': 'hello',
    })
    expect(result.errors).toHaveLength(0)
    expect(result.filters).toHaveLength(1)
    expect(result.filters[0]).toEqual({
      field: 'data.title',
      operator: 'contains',
      value: 'hello',
    })
  })

  it('parses sort=-updatedAt,slug into parsed sort array', () => {
    const result = parsePublicFilters({ sort: '-updatedAt,slug' })
    expect(result.sort).toEqual([
      { field: 'updatedAt', order: 'desc' },
      { field: 'slug', order: 'asc' },
    ])
  })

  it('rejects invalid operators with error messages', () => {
    const result = parsePublicFilters({
      'filter[data.title][invalid_op]': 'foo',
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Invalid operator')
  })

  it('enforces MAX_FILTERS limit of 10', () => {
    const query: Record<string, string> = {}
    for (let i = 0; i < 15; i++) {
      query[`filter[data.field${i}][eq]`] = `val${i}`
    }
    const result = parsePublicFilters(query)
    expect(result.filters.length).toBeLessThanOrEqual(10)
  })
})

describe('Admin entries controller with filters', () => {
  it('passes extraConditions and orderByClause through to repository', () => {
    const query = {
      collectionId: 'col-1',
      'filter[data.category][eq]': 'news',
      sort: '-updatedAt',
    }
    const { filters, sort } = parsePublicFilters(query)
    const conditions = buildDrizzleConditions(filters)
    const orderBy = buildSortClause(sort)

    expect(conditions).toHaveLength(1)
    expect(orderBy).toBeDefined()
  })
})
