import '../../../../test-utils/setup'
import {
  buildEntryFormSchema,
  buildInitialEntryData,
  getAutosaveConflictWarning,
} from './entry-form-schema'

describe('buildEntryFormSchema', () => {
  it('rejects invalid JSON input for json fields', () => {
    const schema = buildEntryFormSchema([
      { name: 'payload', type: 'json', required: true, localizable: false },
    ])

    const parsed = schema.safeParse({
      slug: 'entry-a',
      status: 'draft',
      data: { payload: '{invalid-json' },
    })

    expect(parsed.success).toBe(false)
  })

  it('parses valid JSON string into structured value', () => {
    const schema = buildEntryFormSchema([
      { name: 'payload', type: 'json', required: true, localizable: false },
    ])

    const parsed = schema.safeParse({
      slug: 'entry-a',
      status: 'draft',
      data: { payload: '{"hero":"banner","published":true}' },
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.data.payload).toEqual({ hero: 'banner', published: true })
    }
  })

  it('enforces non-empty text for required fields', () => {
    const schema = buildEntryFormSchema([
      { name: 'title', type: 'text', required: true, localizable: false },
    ])

    const parsed = schema.safeParse({
      slug: 'entry-a',
      status: 'draft',
      data: { title: '' },
    })

    expect(parsed.success).toBe(false)
  })

  it('supports array subschema for text fields', () => {
    const schema = buildEntryFormSchema([
      {
        name: 'tags',
        type: 'array',
        required: true,
        localizable: false,
        options: { itemFields: [{ name: 'label', type: 'text', required: true }] },
      },
    ])

    const parsed = schema.safeParse({
      slug: 'entry-a',
      status: 'draft',
      data: { tags: [{ label: 'news' }, { label: 'feature' }] },
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects empty arrays for required array fields', () => {
    const schema = buildEntryFormSchema([
      {
        name: 'tags',
        type: 'array',
        required: true,
        localizable: false,
        options: { itemFields: [{ name: 'label', type: 'text', required: true }] },
      },
    ])

    const parsed = schema.safeParse({
      slug: 'entry-a',
      status: 'draft',
      data: { tags: [] },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects empty values for required multi-select fields', () => {
    const schema = buildEntryFormSchema([
      {
        name: 'audiences',
        type: 'select',
        required: true,
        localizable: false,
        options: {
          multiple: true,
          choices: [
            { value: 'members', label: 'Members' },
            { value: 'guests', label: 'Guests' },
          ],
        },
      },
    ])

    const parsed = schema.safeParse({
      slug: 'entry-a',
      status: 'draft',
      data: { audiences: [] },
    })

    expect(parsed.success).toBe(false)
  })

  it('warns before saving over a newer draft version', () => {
    expect(getAutosaveConflictWarning({ localVersion: 2, remoteVersion: 3 })).toContain(
      'Review the latest version before saving'
    )
    expect(getAutosaveConflictWarning({ localVersion: 3, remoteVersion: 3 })).toBeUndefined()
  })

  it('initializes array fields with empty array defaults', () => {
    const defaults = buildInitialEntryData({
      id: 'c2',
      name: 'Array fields',
      slug: 'array-fields',
      singleton: false,
      defaultLocale: 'en',
      supportedLocales: ['en'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      fields: [
        {
          name: 'tags',
          type: 'array',
          required: false,
          localizable: false,
          options: { itemFields: [{ name: 'label', type: 'text', required: true }] },
        },
      ],
    })

    expect(defaults.tags).toEqual([])
  })

  it('initializes multi-select fields with empty array defaults', () => {
    const defaults = buildInitialEntryData({
      id: 'c3',
      name: 'Select fields',
      slug: 'select-fields',
      singleton: false,
      defaultLocale: 'en',
      supportedLocales: ['en'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      fields: [
        {
          name: 'audiences',
          type: 'select',
          required: false,
          localizable: false,
          options: { multiple: true, choices: [{ value: 'members', label: 'Members' }] },
        },
      ],
    })

    expect(defaults.audiences).toEqual([])
  })
})
