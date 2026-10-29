import { describe, expect, it } from 'bun:test'
import {
  PUBLISHABLE_PACKAGES,
  parsePublishOptions,
  qualifyPackage,
} from './publish-packages'

describe('publish-packages', () => {
  it('parses default options as dryRun', () => {
    const opts = parsePublishOptions([])
    expect(opts.dryRun).toBe(true)
    expect(opts.tag).toBe('latest')
    expect(opts.access).toBe('public')
  })

  it('parses --publish flag to disable dryRun', () => {
    const opts = parsePublishOptions(['--publish'])
    expect(opts.dryRun).toBe(false)
  })

  it('parses custom tag and access flags', () => {
    const opts = parsePublishOptions(['--publish', '--tag=beta', '--access=restricted'])
    expect(opts.dryRun).toBe(false)
    expect(opts.tag).toBe('beta')
    expect(opts.access).toBe('restricted')
  })

  it('defines the 5 required publishable packages', () => {
    expect(PUBLISHABLE_PACKAGES.map((p) => p.name)).toEqual([
      '@edgecms/schemas',
      'create-edgecms-app',
      '@edgecms/plugin-sdk',
      '@edgecms/runtime',
      '@edgecms/client',
    ])
  })

  it('qualifies all publishable packages via npm pack --dry-run', () => {
    const repoRoot = process.cwd()
    for (const pkg of PUBLISHABLE_PACKAGES) {
      const qualification = qualifyPackage(repoRoot, pkg)
      expect(qualification.name).toBe(pkg.name)
      expect(qualification.dryRunPassed).toBe(true)
      expect(qualification.fileCount).toBeGreaterThan(0)
    }
  }, 30_000)
})
