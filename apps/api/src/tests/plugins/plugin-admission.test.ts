import { describe, expect, it } from 'bun:test'
import {
  validatePluginAdmission,
  loadPlugins,
  getLoadedPlugins,
  createPluginRegistry,
} from '../../plugins/plugin-loader'
import type { TrustedPluginDefinition } from '../../plugins/trusted-plugin-catalog'
import { Elysia } from 'elysia'

describe('F12 — Plugin admission deterministic rejection checks', () => {
  const dummyTrustedPlugin: TrustedPluginDefinition = {
    metadata: {
      displayName: 'Dummy Plugin',
      version: '1.0.0',
      description: 'A test plugin',
      category: 'testing',
      permissions: [],
    },
    hooks: {},
    routes: {
      health: () => new Elysia().get('/api/admin/plugins/dummy/health', () => ({ ok: true })),
    },
  }

  it('rejects untrusted plugins with UNTRUSTED_CATALOG', () => {
    const result = validatePluginAdmission(
      { name: 'untrusted-plugin' },
      [{ name: 'untrusted-plugin' }],
      undefined
    )
    expect(result).not.toBeNull()
    expect(result?.rejectionCode).toBe('UNTRUSTED_CATALOG')
    expect(result?.reason).toContain('Plugin is not in trusted catalog')
  })

  it('rejects incompatible core version with INCOMPATIBLE_CORE', () => {
    const result = validatePluginAdmission(
      { name: 'dummy', coreVersionRange: '^99.0.0' },
      [{ name: 'dummy' }],
      dummyTrustedPlugin
    )
    expect(result).not.toBeNull()
    expect(result?.rejectionCode).toBe('INCOMPATIBLE_CORE')
    expect(result?.reason).toContain('EdgeCMS core')
  })

  it('rejects incompatible SDK version with INCOMPATIBLE_SDK', () => {
    const result = validatePluginAdmission(
      { name: 'dummy', sdkVersionRange: '^99.0.0' },
      [{ name: 'dummy' }],
      dummyTrustedPlugin
    )
    expect(result).not.toBeNull()
    expect(result?.rejectionCode).toBe('INCOMPATIBLE_SDK')
    expect(result?.reason).toContain('Plugin SDK')
  })

  it('rejects missing dependencies with MISSING_DEPENDENCY', () => {
    const result = validatePluginAdmission(
      { name: 'dummy', dependencies: ['non-existent-plugin'] },
      [{ name: 'dummy' }],
      dummyTrustedPlugin
    )
    expect(result).not.toBeNull()
    expect(result?.rejectionCode).toBe('MISSING_DEPENDENCY')
    expect(result?.reason).toContain("Missing required plugin dependency: 'non-existent-plugin'")
  })

  it('rejects cyclic dependencies with CYCLIC_DEPENDENCY', () => {
    const manifests = [
      { name: 'plugin-a', dependencies: ['plugin-b'] },
      { name: 'plugin-b', dependencies: ['plugin-a'] },
    ]
    const result = validatePluginAdmission(
      manifests[0]!,
      manifests,
      dummyTrustedPlugin
    )
    expect(result).not.toBeNull()
    expect(result?.rejectionCode).toBe('CYCLIC_DEPENDENCY')
    expect(result?.reason).toContain("Cyclic dependency detected for plugin 'plugin-a'")
  })

  it('rejects missing required Cloudflare bindings with MISSING_REQUIRED_BINDING', () => {
    const result = validatePluginAdmission(
      { name: 'dummy', requiredBindings: ['MEDIA'] },
      [{ name: 'dummy' }],
      dummyTrustedPlugin,
      { CACHE: {} } // missing MEDIA
    )
    expect(result).not.toBeNull()
    expect(result?.rejectionCode).toBe('MISSING_REQUIRED_BINDING')
    expect(result?.reason).toContain("Missing required environment binding: 'MEDIA'")
  })

  it('rejects duplicate route ownership with DUPLICATE_OWNERSHIP', () => {
    const claimedRoutes = new Set<string>(['health'])
    const result = validatePluginAdmission(
      { name: 'dummy' },
      [{ name: 'dummy' }],
      dummyTrustedPlugin,
      undefined,
      claimedRoutes
    )
    expect(result).not.toBeNull()
    expect(result?.rejectionCode).toBe('DUPLICATE_OWNERSHIP')
    expect(result?.reason).toContain("Duplicate route ownership detected for 'health'")
  })

  it('blocks admitted plugins in loadPlugins and records rejectionCode in loaded metadata', async () => {
    const registry = createPluginRegistry()
    const pluginA: TrustedPluginDefinition = {
      hooks: {},
      routes: {
        sharedRoute: () => new Elysia().get('/api/admin/plugins/plugin-a/sharedRoute', () => ({ ok: true })),
      },
    }
    const pluginB: TrustedPluginDefinition = {
      hooks: {},
      routes: {
        sharedRoute: () => new Elysia().get('/api/admin/plugins/plugin-b/sharedRoute', () => ({ ok: true })),
      },
    }

    await loadPlugins(
      [
        { name: 'plugin-a', enabled: true },
        { name: 'plugin-b', enabled: true },
        { name: 'missing-dep', enabled: true, dependencies: ['ghost-plugin'] },
      ],
      registry,
      (name) => {
        if (name === 'plugin-a') return pluginA
        if (name === 'plugin-b') return pluginB
        if (name === 'missing-dep') return dummyTrustedPlugin
        return undefined
      }
    )

    const loaded = getLoadedPlugins()
    const admittedA = loaded.find((p) => p.name === 'plugin-a')
    const blockedB = loaded.find((p) => p.name === 'plugin-b')
    const blockedMissing = loaded.find((p) => p.name === 'missing-dep')

    expect(admittedA?.status).toBe('loaded')
    expect(blockedB?.status).toBe('blocked')
    expect(blockedB?.rejectionCode).toBe('DUPLICATE_OWNERSHIP')
    expect(blockedMissing?.status).toBe('blocked')
    expect(blockedMissing?.rejectionCode).toBe('MISSING_DEPENDENCY')
  })
})
