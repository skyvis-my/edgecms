import { describe, expect, it } from 'bun:test'

import { API_VERSION } from '../version'

describe('API_VERSION', () => {
  it('matches apps/api/package.json version', async () => {
    const packageJsonUrl = new URL('../../package.json', import.meta.url)
    const pkg = (await Bun.file(packageJsonUrl).json()) as { version?: unknown }

    const packageVersion = pkg.version
    expect(typeof packageVersion).toBe('string')
    expect(packageVersion).toBe(API_VERSION)
  })
})
