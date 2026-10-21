import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkPrdReference, listPrdIds } from './check-prd-reference'

const prd = readFileSync(new URL('../PRD.md', import.meta.url), 'utf8')

describe('check-prd-reference', () => {
  it('reads requirement, principle, goal and non-goal IDs from PRD.md', () => {
    const ids = listPrdIds(prd)
    for (const id of ['P1', 'P10', 'G1', 'NG5', 'CM-01', 'DL-08', 'OP-08']) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('accepts known IDs and n/a', () => {
    expect(checkPrdReference('## Summary\n\nPRD: DL-08, P5\n', prd)).toEqual([])
    expect(checkPrdReference('PRD: n/a (CI only)', prd)).toEqual([])
  })

  it('rejects a missing line, empty value and unknown IDs', () => {
    expect(checkPrdReference('## Summary\nNo reference', prd)).toHaveLength(1)
    expect(checkPrdReference('PRD: <!-- IDs --> something', prd)).toHaveLength(1)
    expect(checkPrdReference('PRD: DL-99', prd)).toEqual(['DL-99 is not defined in PRD.md.'])
  })
})
