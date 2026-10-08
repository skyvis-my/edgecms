import { describe, expect, it } from 'bun:test'
import {
  arrayValueAsText,
  buildArrayItemDefault,
  getLocaleValue,
  parseArrayValue,
} from './field-renderer-utils'
import type { ArrayItemSubfield } from './field-renderer-utils'

describe('getLocaleValue', () => {
  it('returns the raw value when localizable is false', () => {
    expect(getLocaleValue('hello', false, 'en')).toBe('hello')
  })

  it('returns the raw value when activeLocale is undefined', () => {
    expect(getLocaleValue({ en: 'english', fr: 'french' }, true, undefined)).toEqual({
      en: 'english',
      fr: 'french',
    })
  })

  it('returns the raw value when activeLocale is empty string', () => {
    expect(getLocaleValue({ en: 'english' }, true, '')).toEqual({ en: 'english' })
  })

  it('extracts the locale-specific value from an object', () => {
    const value = { en: 'Hello', fr: 'Bonjour', de: 'Hallo' }
    expect(getLocaleValue(value, true, 'fr')).toBe('Bonjour')
  })

  it('returns empty string when the locale key is missing', () => {
    const value = { en: 'Hello' }
    expect(getLocaleValue(value, true, 'fr')).toBe('')
  })

  it('returns empty string when value is null and localizable', () => {
    expect(getLocaleValue(null, true, 'en')).toBe('')
  })

  it('returns empty string when value is undefined and localizable', () => {
    expect(getLocaleValue(undefined, true, 'en')).toBe('')
  })

  it('returns empty string when value is a string (not an object) and localizable', () => {
    expect(getLocaleValue('not-an-object', true, 'en')).toBe('')
  })

  it('returns empty string when value is a number (not an object) and localizable', () => {
    expect(getLocaleValue(42, true, 'en')).toBe('')
  })

  it('returns the value at the locale key even if it is falsy (0)', () => {
    const value = { en: 0 }
    expect(getLocaleValue(value, true, 'en')).toBe(0)
  })

  it('returns empty string when locale value is explicitly undefined', () => {
    const value = { en: undefined }
    expect(getLocaleValue(value, true, 'en')).toBe('')
  })

  it('returns empty string when locale value is null (nullish coalescing)', () => {
    // The implementation uses ?? '' so null falls back to empty string
    const value = { en: null }
    expect(getLocaleValue(value, true, 'en')).toBe('')
  })
})

describe('parseArrayValue', () => {
  describe('string type (default)', () => {
    it('parses newline-separated strings', () => {
      expect(parseArrayValue('apple\nbanana\ncherry', 'text')).toEqual([
        'apple',
        'banana',
        'cherry',
      ])
    })

    it('trims whitespace from each line', () => {
      expect(parseArrayValue('  hello  \n  world  ', 'text')).toEqual(['hello', 'world'])
    })

    it('filters out empty lines', () => {
      expect(parseArrayValue('first\n\n\nsecond', 'text')).toEqual(['first', 'second'])
    })

    it('returns empty array for empty string', () => {
      expect(parseArrayValue('', 'text')).toEqual([])
    })

    it('returns empty array for whitespace-only input', () => {
      expect(parseArrayValue('   \n   \n   ', 'text')).toEqual([])
    })

    it('handles a single value', () => {
      expect(parseArrayValue('only-one', 'text')).toEqual(['only-one'])
    })
  })

  describe('number type', () => {
    it('parses newline-separated numbers', () => {
      expect(parseArrayValue('1\n2\n3', 'number')).toEqual([1, 2, 3])
    })

    it('parses floating-point numbers', () => {
      expect(parseArrayValue('1.5\n2.7\n3.14', 'number')).toEqual([1.5, 2.7, 3.14])
    })

    it('filters out non-numeric lines', () => {
      expect(parseArrayValue('1\nabc\n3', 'number')).toEqual([1, 3])
    })

    it('filters out NaN values', () => {
      expect(parseArrayValue('NaN\n42', 'number')).toEqual([42])
    })

    it('filters out Infinity values', () => {
      expect(parseArrayValue('Infinity\n-Infinity\n5', 'number')).toEqual([5])
    })

    it('parses negative numbers', () => {
      expect(parseArrayValue('-10\n-20', 'number')).toEqual([-10, -20])
    })

    it('returns empty array for empty input', () => {
      expect(parseArrayValue('', 'number')).toEqual([])
    })

    it('handles zero', () => {
      expect(parseArrayValue('0', 'number')).toEqual([0])
    })
  })

  describe('boolean type', () => {
    it('parses true and false strings', () => {
      expect(parseArrayValue('true\nfalse\ntrue', 'boolean')).toEqual([true, false, true])
    })

    it('is case-insensitive', () => {
      expect(parseArrayValue('TRUE\nFALSE\nTrue\nFalse', 'boolean')).toEqual([
        true,
        false,
        true,
        false,
      ])
    })

    it('filters out invalid boolean strings', () => {
      expect(parseArrayValue('true\nyes\nno\nfalse\n1\n0', 'boolean')).toEqual([true, false])
    })

    it('returns empty array for empty input', () => {
      expect(parseArrayValue('', 'boolean')).toEqual([])
    })

    it('returns empty array for only non-boolean strings', () => {
      expect(parseArrayValue('yes\nno\n1\n0', 'boolean')).toEqual([])
    })
  })
})

describe('arrayValueAsText', () => {
  it('joins array items with newlines', () => {
    expect(arrayValueAsText(['apple', 'banana', 'cherry'])).toBe('apple\nbanana\ncherry')
  })

  it('converts numeric items to strings', () => {
    expect(arrayValueAsText([1, 2, 3])).toBe('1\n2\n3')
  })

  it('converts boolean items to strings', () => {
    expect(arrayValueAsText([true, false])).toBe('true\nfalse')
  })

  it('converts null items to empty strings', () => {
    expect(arrayValueAsText([null, 'hello', null])).toBe('\nhello\n')
  })

  it('converts undefined items to empty strings', () => {
    expect(arrayValueAsText([undefined, 'world'])).toBe('\nworld')
  })

  it('returns empty string for empty array', () => {
    expect(arrayValueAsText([])).toBe('')
  })

  it('returns empty string for non-array input', () => {
    expect(arrayValueAsText('not-an-array')).toBe('')
  })

  it('returns empty string for null input', () => {
    expect(arrayValueAsText(null)).toBe('')
  })

  it('returns empty string for undefined input', () => {
    expect(arrayValueAsText(undefined)).toBe('')
  })

  it('returns empty string for object input', () => {
    expect(arrayValueAsText({ key: 'value' })).toBe('')
  })

  it('handles single-element arrays', () => {
    expect(arrayValueAsText(['only'])).toBe('only')
  })
})

describe('buildArrayItemDefault', () => {
  it('returns an empty object for empty subfields', () => {
    expect(buildArrayItemDefault([])).toEqual({})
  })

  it('sets boolean fields to false', () => {
    const subfields: ArrayItemSubfield[] = [{ name: 'isActive', type: 'boolean' }]
    expect(buildArrayItemDefault(subfields)).toEqual({ isActive: false })
  })

  it('sets non-boolean fields to null', () => {
    const subfields: ArrayItemSubfield[] = [
      { name: 'title', type: 'text' },
      { name: 'count', type: 'number' },
      { name: 'publishedAt', type: 'date' },
    ]
    expect(buildArrayItemDefault(subfields)).toEqual({
      title: null,
      count: null,
      publishedAt: null,
    })
  })

  it('handles a mix of boolean and non-boolean fields', () => {
    const subfields: ArrayItemSubfield[] = [
      { name: 'name', type: 'text' },
      { name: 'enabled', type: 'boolean' },
      { name: 'value', type: 'number' },
      { name: 'visible', type: 'boolean' },
    ]
    expect(buildArrayItemDefault(subfields)).toEqual({
      name: null,
      enabled: false,
      value: null,
      visible: false,
    })
  })

  it('uses the name property of each subfield as the key', () => {
    const subfields: ArrayItemSubfield[] = [
      { name: 'customFieldName', type: 'text' },
    ]
    const result = buildArrayItemDefault(subfields)
    expect(result).toHaveProperty('customFieldName')
    expect(result.customFieldName).toBeNull()
  })

  it('handles richtext, media, relation, json, array types as null', () => {
    const subfields: ArrayItemSubfield[] = [
      { name: 'content', type: 'richtext' },
      { name: 'image', type: 'media' },
      { name: 'ref', type: 'relation' },
      { name: 'meta', type: 'json' },
      { name: 'items', type: 'array' },
    ]
    expect(buildArrayItemDefault(subfields)).toEqual({
      content: null,
      image: null,
      ref: null,
      meta: null,
      items: null,
    })
  })
})
