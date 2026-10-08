import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { scanClaims } from './docs-claim-scan'
import { findBrokenLocalLinks } from './docs-link-check'

describe('docs quality scripts', () => {
  it('flags unsupported public claims', () => {
    const root = mkdtempSync(join(tmpdir(), 'edgecms-docs-claim-'))
    writeFileSync(join(root, 'claim.md'), 'This package is published to npm.')

    expect(scanClaims(root)).toHaveLength(1)
  })

  it('flags unsupported delivery and performance claims', () => {
    const root = mkdtempSync(join(tmpdir(), 'edgecms-docs-claim-expanded-'))
    writeFileSync(
      join(root, 'claim.md'),
      [
        'Production cache purge proof is ready.',
        'Remote performance proof complete.',
        'Full OpenAPI generation is shipped.',
        'GraphQL parity is shipped.',
        'Production migration proof complete.',
        'Production backup proof complete.',
        'Marketplace support is available.',
        'Arbitrary query engine is supported.',
        'Autonomous AI execution is shipped.',
        'Unreviewed AI mutation is available.',
        'Anonymous draft preview route is shipped.',
        'Production security header rollout is complete.',
        'Full autosave is shipped.',
        'Destructive import apply is available.',
        'Data portability parity is supported.',
      ].join('\n')
    )

    expect(scanClaims(root)).toHaveLength(15)
  })

  it('allows explicit local-only and deferred-proof boundaries', () => {
    const root = mkdtempSync(join(tmpdir(), 'edgecms-docs-claim-negated-'))
    writeFileSync(
      join(root, 'claim.md'),
      [
        'No full OpenAPI generation is claimed.',
        'No GraphQL parity claim is made.',
        'No production migration run occurred.',
        'No production backup claim is made.',
        'No marketplace support claim is made.',
        'No autonomous AI execution claim is made.',
        'No unreviewed mutation claim is made.',
        'No public draft route claim is made.',
        'No production security-header rollout claim is made.',
        'No full autosave claim is made.',
        'No destructive import apply claim is made.',
        'No data-portability parity claim is made.',
      ].join('\n')
    )

    expect(scanClaims(root)).toEqual([])
  })

  it('detects broken local markdown links', () => {
    const root = mkdtempSync(join(tmpdir(), 'edgecms-docs-link-'))
    writeFileSync(join(root, 'index.md'), '[Missing](missing.md)')

    expect(findBrokenLocalLinks(root)).toEqual([`${join(root, 'index.md')} -> missing.md`])
  })

  it('accepts existing local markdown links', () => {
    const root = mkdtempSync(join(tmpdir(), 'edgecms-docs-link-pass-'))
    writeFileSync(join(root, 'target.md'), '# Target')
    writeFileSync(join(root, 'index.md'), '[Target](target.md)')

    expect(findBrokenLocalLinks(root)).toEqual([])
  })
})
