import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  formatCoverageSummary,
  parseCoverageOptions,
  parseLcov,
  runCoverageGate,
} from './coverage-gate'

const SAMPLE_LCOV = [
  'TN:',
  'SF:src/example.ts',
  'FN:1,covered',
  'FN:2,uncovered',
  'FNF:2',
  'FNH:1',
  'DA:1,1',
  'DA:2,0',
  'LF:2',
  'LH:1',
  'BRDA:1,0,0,1',
  'BRDA:2,0,0,0',
  'BRF:2',
  'BRH:1',
  'end_of_record',
].join('\n')

describe('coverage-gate lcov parser', () => {
  it('summarizes lines, functions, and branches from lcov counters', () => {
    expect(parseLcov(SAMPLE_LCOV)).toEqual({
      lines: { covered: 1, found: 2, percent: 50 },
      functions: { covered: 1, found: 2, percent: 50 },
      branches: { covered: 1, found: 2, percent: 50 },
    })
  })

  it('treats empty branch totals as fully covered', () => {
    const summary = parseLcov(['SF:src/example.ts', 'LF:1', 'LH:1', 'FNF:1', 'FNH:1'].join('\n'))

    expect(summary.branches).toEqual({ covered: 0, found: 0, percent: 100 })
  })

  it('formats compact human-readable summaries', () => {
    expect(formatCoverageSummary('api', parseLcov(SAMPLE_LCOV))).toContain('lines 50% (1/2)')
  })
})

describe('coverage-gate option parser', () => {
  it('parses targets and explicit thresholds', () => {
    expect(
      parseCoverageOptions([
        '--target',
        'api:coverage/api/lcov.info',
        '--min-lines=90',
        '--min-functions',
        '91',
        '--min-branches=92',
      ])
    ).toEqual({
      targets: [{ label: 'api', path: 'coverage/api/lcov.info' }],
      minimums: { lines: 90, functions: 91, branches: 92 },
    })
  })

  it('defaults to strict 100% minimums', () => {
    expect(parseCoverageOptions(['--target=admin:coverage/admin/lcov.info']).minimums).toEqual({
      lines: 100,
      functions: 100,
      branches: 100,
    })
  })

  it('rejects invalid thresholds', () => {
    expect(() =>
      parseCoverageOptions(['--target=api:coverage/api/lcov.info', '--min-lines=101'])
    ).toThrow('Invalid lines minimum: 101')
  })

  it('fails strict gates when a required metric has no counters', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coverage-gate-'))
    const lcovPath = join(dir, 'lcov.info')

    try {
      writeFileSync(lcovPath, ['SF:src/example.ts', 'LF:1', 'LH:1', 'FNF:1', 'FNH:1'].join('\n'))

      expect(
        runCoverageGate([
          '--target',
          `api:${lcovPath}`,
          '--min-lines=100',
          '--min-functions=100',
          '--min-branches=100',
        ])
      ).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
