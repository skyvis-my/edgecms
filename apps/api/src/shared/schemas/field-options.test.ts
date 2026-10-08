import { describe, it, expect } from 'bun:test'
import { type } from 'arktype'
import {
  arrayFieldOptions,
  colorFieldOptions,
  emailFieldOptions,
  markdownFieldOptions,
  mediaFieldOptions,
  referenceFieldOptions,
  textFieldOptions,
  numberFieldOptions,
  selectFieldOptions,
  baseFieldOptions,
  slugFieldOptions,
  urlFieldOptions,
} from './field-options'

describe('field options schemas', () => {
  it('validates text field options', () => {
    const result = textFieldOptions({
      placeholder: 'Enter title',
      helpText: 'The article title',
      minLength: 1,
      maxLength: 200,
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('validates number field options', () => {
    const result = numberFieldOptions({
      min: 0,
      max: 100,
      step: 1,
      placeholder: 'Enter count',
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('validates select field options', () => {
    const result = selectFieldOptions({
      choices: [
        { value: 'draft', label: 'Draft' },
        { value: 'published', label: 'Published' },
      ],
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('validates reference field options', () => {
    const result = referenceFieldOptions({
      referencedCollections: ['blog_posts', 'pages'],
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('validates reference field relation metadata', () => {
    const result = referenceFieldOptions({
      relationType: 'one-to-many',
      targetCollectionId: 'collection-id',
      targetCollectionSlug: 'posts',
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('validates markdown field options', () => {
    const result = markdownFieldOptions({
      placeholder: 'Markdown body',
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('validates email field options', () => {
    const result = emailFieldOptions({
      helpText: 'Contact email',
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('validates url field options', () => {
    const result = urlFieldOptions({
      placeholder: 'https://example.com',
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('validates slug field options', () => {
    const result = slugFieldOptions({
      generateFrom: 'title',
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('validates color field options', () => {
    const result = colorFieldOptions({
      format: 'hex',
      default: '#123456',
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('validates media field options', () => {
    const result = mediaFieldOptions({
      accept: ['image/*', 'application/pdf'],
      maxSizeBytes: 5242880,
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('rejects invalid media max size options', () => {
    const result = mediaFieldOptions({
      maxSizeBytes: 0,
    })
    expect(result instanceof type.errors).toBe(true)
  })

  it('accepts allowed array item field types', () => {
    const result = arrayFieldOptions({
      itemFields: [
        { name: 'title', type: 'text', required: true },
        { name: 'caption', type: 'markdown', required: false },
        { name: 'flag', type: 'boolean' },
      ],
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('rejects relation or nested array item types', () => {
    const result = arrayFieldOptions({
      itemFields: [
        { name: 'child', type: 'relation' },
        { name: 'nested', type: 'array' },
      ],
    })
    expect(result instanceof type.errors).toBe(true)
  })
})

describe('baseFieldOptions with conditional display', () => {
  it('accepts dependsOn and showWhen fields', () => {
    const result = baseFieldOptions({
      dependsOn: 'category',
      showWhen: { operator: 'eq', value: 'blog' },
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('accepts showWhen with in operator', () => {
    const result = baseFieldOptions({
      dependsOn: 'type',
      showWhen: { operator: 'in', value: ['blog', 'article'] },
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('accepts showWhen with exists operator', () => {
    const result = baseFieldOptions({
      dependsOn: 'featured',
      showWhen: { operator: 'exists' },
    })
    expect(result instanceof type.errors).toBe(false)
  })

  it('accepts showWhen without dependsOn (schema level)', () => {
    // showWhen without dependsOn should still be valid schema-wise
    // (business logic validates the pair at form level)
    const result = baseFieldOptions({
      showWhen: { operator: 'eq', value: 'test' },
    })
    expect(result instanceof type.errors).toBe(false)
  })
})
