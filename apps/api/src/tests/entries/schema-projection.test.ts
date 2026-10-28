import { describe, expect, it } from 'bun:test'
import { projectEntryDataWithSchema } from '../../entries/schema-projection'

describe('Domain 1: Expand-Contract Schema Projection', () => {
  it('projects renamedFrom when modern field is missing', () => {
    const rawData = {
      headline: 'Breaking News',
      body: 'Content here',
    }
    const fields = [
      { name: 'title', renamedFrom: 'headline' },
      { name: 'body' },
    ]

    const projected = projectEntryDataWithSchema(rawData, fields)

    expect(projected.title).toBe('Breaking News')
    expect(projected.body).toBe('Content here')
    expect(projected.headline).toBe('Breaking News') // legacy preserved for backward compat
  })

  it('does not overwrite modern field if already set', () => {
    const rawData = {
      title: 'Modern Title',
      headline: 'Old Headline',
    }
    const fields = [{ name: 'title', renamedFrom: 'headline' }]

    const projected = projectEntryDataWithSchema(rawData, fields)

    expect(projected.title).toBe('Modern Title')
  })

  it('projects defaultValue when field is undefined', () => {
    const rawData = {
      title: 'Article 1',
    }
    const fields = [
      { name: 'title' },
      { name: 'isFeatured', defaultValue: false },
      { name: 'views', defaultValue: 0 },
    ]

    const projected = projectEntryDataWithSchema(rawData, fields)

    expect(projected.title).toBe('Article 1')
    expect(projected.isFeatured).toBe(false)
    expect(projected.views).toBe(0)
  })

  it('handles null/undefined rawRecord safely', () => {
    const fields = [{ name: 'status', defaultValue: 'active' }]
    const projected = projectEntryDataWithSchema(null, fields)
    expect(projected.status).toBe('active')
  })
})
