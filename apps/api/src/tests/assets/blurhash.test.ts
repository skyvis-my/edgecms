import { describe, expect, it } from 'bun:test'
import { MAX_BLURHASH_LENGTH, isValidBlurhash, normalizeBlurhash } from '../../assets/blurhash'

describe('MD-03 blurhash validation', () => {
  it('accepts well-formed blurhashes of every component size', () => {
    // 4x3 components: size flag "L" (21) -> 4 + 2 * 12 = 28 chars.
    expect(isValidBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMdnj')).toBe(true)
    // 1x1 components: size flag "0" -> 6 chars.
    expect(isValidBlurhash('00TI:j')).toBe(true)
    // 9x9 components: size flag "|" (80) -> 4 + 2 * 81 = 166 chars.
    expect(isValidBlurhash(`|${'0'.repeat(MAX_BLURHASH_LENGTH - 1)}`)).toBe(true)
  })

  it('rejects strings whose length does not match the size flag', () => {
    expect(isValidBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMdn')).toBe(false)
    expect(isValidBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMdnjj')).toBe(false)
    expect(isValidBlurhash('00TI:')).toBe(false)
  })

  it('rejects characters outside the base83 alphabet', () => {
    expect(isValidBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMdn<')).toBe(false)
    expect(isValidBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMdn"')).toBe(false)
    expect(isValidBlurhash('LEHV6nWB2yk8pyo0adR*.7kCMd n')).toBe(false)
    expect(isValidBlurhash('<script>')).toBe(false)
  })

  it('rejects a size flag above 9x9 and oversized input', () => {
    // "}" is 81 -> numY 10: not a valid component count.
    expect(isValidBlurhash(`}${'0'.repeat(203)}`)).toBe(false)
    expect(isValidBlurhash('0'.repeat(MAX_BLURHASH_LENGTH + 1))).toBe(false)
  })

  it('rejects non-strings and empty strings', () => {
    expect(isValidBlurhash('')).toBe(false)
    expect(isValidBlurhash(undefined)).toBe(false)
    expect(isValidBlurhash(null)).toBe(false)
    expect(isValidBlurhash(42)).toBe(false)
  })

  it('normalizeBlurhash treats absent/blank as undefined and throws on malformed values', () => {
    expect(normalizeBlurhash(undefined)).toBeUndefined()
    expect(normalizeBlurhash(null)).toBeUndefined()
    expect(normalizeBlurhash('   ')).toBeUndefined()
    expect(normalizeBlurhash(' LEHV6nWB2yk8pyo0adR*.7kCMdnj ')).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj')
    expect(() => normalizeBlurhash('not a blurhash')).toThrow(/Invalid blurhash/)
    expect(() => normalizeBlurhash(123)).toThrow(/Invalid blurhash/)
  })
})
