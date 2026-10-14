import { describe, expect, it } from 'bun:test'
import { CANONICAL_LOCALES } from './locales'

describe('locales', () => {
  it('exports canonical locales with non-empty values and labels', () => {
    expect(CANONICAL_LOCALES.length).toBeGreaterThan(0)
    for (const locale of CANONICAL_LOCALES) {
      expect(typeof locale.value).toBe('string')
      expect(locale.value.length).toBeGreaterThan(0)
      expect(typeof locale.label).toBe('string')
      expect(locale.label.length).toBeGreaterThan(0)
    }
  })

  it('includes standard default locales', () => {
    const values = CANONICAL_LOCALES.map((l) => l.value)
    expect(values).toContain('en')
    expect(values).toContain('en-US')
    expect(values).toContain('zh-CN')
    expect(values).toContain('ja')
    expect(values).toContain('fr')
  })
})
