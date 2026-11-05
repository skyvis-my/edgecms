import { describe, expect, it } from 'bun:test'
import {
  compareSemver,
  isValidSemverRange,
  parseSemver,
  satisfiesSemverRange,
} from '../index'

describe('EX-02 parseSemver', () => {
  it('parses full versions, prerelease and build metadata', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseSemver('v0.2.0')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: [] })
    expect(parseSemver('1.0.0-beta.2+build.7')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ['beta', 2],
    })
  })

  it('rejects partial, padded or malformed versions', () => {
    for (const value of ['1.2', '01.2.3', '1.2.3.4', 'banana', '', '1.2.x', '^1.2.3', '1.2.3-']) {
      expect(parseSemver(value)).toBeNull()
    }
  })
})

describe('EX-02 compareSemver', () => {
  it('orders by precedence, with prereleases before the release', () => {
    const ordered = [
      '0.9.9',
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0',
      '1.0.1',
      '1.10.0',
      '2.0.0',
    ]
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareSemver(ordered[i]!, ordered[i + 1]!)).toBe(-1)
      expect(compareSemver(ordered[i + 1]!, ordered[i]!)).toBe(1)
    }
    expect(compareSemver('1.0.0+a', '1.0.0+b')).toBe(0)
  })
})

describe('EX-02 satisfiesSemverRange', () => {
  const cases: Array<[string, string, boolean]> = [
    // wildcards
    ['0.2.0', '*', true],
    ['5.1.0', 'x', true],
    ['1.2.3', '', true],
    // exact and partial
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.2.9', '1.2', true],
    ['1.3.0', '1.2', false],
    ['1.9.0', '1.x', true],
    ['2.0.0', '1', false],
    ['1.2.3', '=1.2.3', true],
    // caret
    ['1.9.9', '^1.2.3', true],
    ['2.0.0', '^1.2.3', false],
    ['1.2.2', '^1.2.3', false],
    ['0.2.5', '^0.2.0', true],
    ['0.3.0', '^0.2.0', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['0.9.0', '^0.x', true],
    ['1.0.0', '^0.x', false],
    // tilde
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.9.0', '~1', true],
    ['2.0.0', '~1', false],
    // comparators and intersections
    ['0.2.0', '>=0.2.0 <1.0.0', true],
    ['1.0.0', '>=0.2.0 <1.0.0', false],
    ['0.1.9', '>=0.2.0 <1.0.0', false],
    ['1.3.0', '>1.2', true],
    ['1.2.9', '>1.2', false],
    ['1.2.9', '<=1.2', true],
    ['1.3.0', '<=1.2', false],
    ['1.1.9', '<1.2', true],
    ['1.2.0', '<1.2', false],
    ['1.2.0', '>= 1.2.0', true],
    // unions
    ['2.5.0', '^1.0.0 || ^2.0.0', true],
    ['3.0.0', '^1.0.0 || ^2.0.0', false],
    // hyphen ranges
    ['1.5.0', '1.2.3 - 2.3.4', true],
    ['2.3.4', '1.2.3 - 2.3.4', true],
    ['2.3.5', '1.2.3 - 2.3.4', false],
    ['2.3.9', '1.2 - 2.3', true],
    ['2.4.0', '1.2 - 2.3', false],
    // prereleases only match a comparator on the same release tuple
    ['1.0.0-beta.1', '^1.0.0', false],
    ['1.0.0-beta.2', '>=1.0.0-beta.1 <2.0.0', true],
    ['1.1.0-beta.1', '>=1.0.0-beta.1 <2.0.0', false],
    ['1.0.0-alpha', '>=1.0.0-beta.1', false],
  ]

  for (const [version, range, expected] of cases) {
    it(`${version} ${expected ? 'satisfies' : 'does not satisfy'} "${range}"`, () => {
      expect(satisfiesSemverRange(version, range)).toBe(expected)
    })
  }

  it('fails closed on an invalid version or range', () => {
    expect(satisfiesSemverRange('banana', '*')).toBe(false)
    expect(satisfiesSemverRange('1.0.0', 'banana')).toBe(false)
    expect(satisfiesSemverRange('1.0.0', '>=1.0.0 <')).toBe(false)
    expect(satisfiesSemverRange('1.0.0', '^^1.0.0')).toBe(false)
    expect(satisfiesSemverRange('1.0.0', '1.0.0 ||')).toBe(false)
    expect(satisfiesSemverRange('1.0.0', 'latest')).toBe(false)
  })

  it('reports range validity without a version', () => {
    expect(isValidSemverRange('^1.2.3 || >=3.0.0 <4')).toBe(true)
    expect(isValidSemverRange('1.2.3 - 2')).toBe(true)
    expect(isValidSemverRange('~>1.2')).toBe(false)
    expect(isValidSemverRange('1.2.3 -')).toBe(false)
    expect(isValidSemverRange('x'.repeat(300))).toBe(false)
  })
})
