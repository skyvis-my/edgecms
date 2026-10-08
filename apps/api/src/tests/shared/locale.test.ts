import { describe, expect, it } from 'bun:test'
import { flattenLocaleFields } from '../../shared/locale'

describe('flattenLocaleFields', () => {
  const fields = [
    { name: 'title', localizable: true },
    { name: 'slug', localizable: false },
  ]

  it('flattens localizable fields to requested locale', () => {
    const data = { title: { en: 'Hello', fr: 'Bonjour' }, slug: 'hello' }
    const result = flattenLocaleFields(data, fields, 'fr', 'en')
    expect(result).toEqual({ title: 'Bonjour', slug: 'hello' })
  })

  it('falls back to default locale when requested locale missing', () => {
    const data = { title: { en: 'Hello' }, slug: 'hello' }
    const result = flattenLocaleFields(data, fields, 'de', 'en')
    expect(result).toEqual({ title: 'Hello', slug: 'hello' })
  })

  it('returns null when neither locale exists', () => {
    const data = { title: { ja: 'Hi' }, slug: 'hello' }
    const result = flattenLocaleFields(data, fields, 'de', 'en')
    expect(result).toEqual({ title: null, slug: 'hello' })
  })

  it('passes through non-localizable fields unchanged', () => {
    const data = { title: { en: 'Hi' }, slug: 'test' }
    const result = flattenLocaleFields(data, fields, 'en', 'en')
    expect(result).toEqual({ title: 'Hi', slug: 'test' })
  })

  it('passes through array values without flattening', () => {
    const fields2 = [{ name: 'tags', localizable: true }]
    const data = { tags: ['a', 'b'] }
    const result = flattenLocaleFields(data, fields2, 'en', 'en')
    expect(result).toEqual({ tags: ['a', 'b'] })
  })

  it('passes through primitive localizable fields', () => {
    const data = { title: 'plain string', slug: 'test' }
    const result = flattenLocaleFields(data, fields, 'en', 'en')
    expect(result).toEqual({ title: 'plain string', slug: 'test' })
  })
})
