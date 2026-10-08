import { afterAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'

vi.mock('cloudflare:workers', () => ({
  env: {},
}))
vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia(),
}))

// Import loadPlugins from the original module so it shares state (loadedPlugins)
// with the controller's getLoadedPlugins import. Use a cache-busted pluginRegistry
// to avoid mock contamination from engine.test.ts.
await import(`../../plugins/plugin-registry?_t=${Date.now()}`)

describe('pluginsController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns loaded plugin manifests for admin UI', async () => {
    const pluginRegistryModule = await import(
      `../../plugins/plugin-registry?bypass=${Date.now()}`
    )
    const { pluginRegistry } = pluginRegistryModule

    // Re-mock plugin-registry so plugin-loader picks up the fresh instance
    mock.module('@/plugins/plugin-registry', () => ({
      ...pluginRegistryModule,
      pluginRegistry,
    }))

    // Use cache-busted import to get fresh plugin-loader instance
    const pluginLoaderModule = await import(
      `../../plugins/plugin-loader?bypass=${Date.now()}`
    )
    const { loadPlugins, getLoadedPlugins } = pluginLoaderModule

    // Re-mock plugin-loader so the controller reads from the same instance
    mock.module('@/plugins/plugin-loader', () => ({
      ...pluginLoaderModule,
      loadPlugins,
      getLoadedPlugins,
      getLoadedPluginAiTools: vi.fn().mockReturnValue([]),
      parsePluginConfig: vi.fn().mockReturnValue([]),
      reloadConfiguredPlugins: vi.fn(),
      createLoadedPluginRoutesController: vi.fn(),
    }))

    await loadPlugins([
      {
        name: 'audit-trace',
        enabled: true,
      },
      {
        name: 'legacy-plugin',
        enabled: false,
      },
      {
        name: 'unknown-plugin',
        enabled: true,
      },
    ], pluginRegistry)

    const { pluginsController } = await import(
      `../../plugins/plugins.controller?bypass=${Date.now()}`
    )
    const app = new Elysia().use(pluginsController)

    const response = await app.handle(new Request('http://localhost/api/admin/plugins'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      data: Array<{
        name: string
        enabled: boolean
        hooks: string[]
        aiTools: string[]
        routes: string[]
        adminRoutes: string[]
        publicRoutes: string[]
        status: 'loaded' | 'blocked' | 'disabled'
        sandbox: 'trusted_catalog'
        metadata?: {
          displayName: string
          description: string
          version: string
          category?: string
          permissions?: string[]
        }
        adminMenu: Array<{ label: string; path: string; group?: string }>
        reason?: string
        rejectionCode?: string
      }>
    }
    expect(body.success).toBe(true)
    expect(body.data).toEqual([
      {
        name: 'audit-trace',
        enabled: true,
        hooks: ['beforeCommand', 'afterCommand', 'beforeAiCommand'],
        aiTools: ['pluginUpdateEntry'],
        routes: ['health'],
        adminRoutes: ['health'],
        publicRoutes: [],
        status: 'loaded',
        sandbox: 'trusted_catalog',
        metadata: {
          displayName: 'Audit Trace',
          description: 'Records command lifecycle hooks for operational audit visibility.',
          version: '1.0.0',
          category: 'operations',
          permissions: ['commands:read'],
        },
        adminMenu: [
          {
            label: 'Audit Trace',
            path: '/settings/plugins/audit-trace',
            group: 'Operations',
          },
        ],
      },
      {
        name: 'legacy-plugin',
        enabled: false,
        hooks: [],
        aiTools: [],
        routes: [],
        adminRoutes: [],
        publicRoutes: [],
        status: 'disabled',
        sandbox: 'trusted_catalog',
        adminMenu: [],
      },
      {
        name: 'unknown-plugin',
        enabled: true,
        hooks: [],
        aiTools: [],
        routes: [],
        adminRoutes: [],
        publicRoutes: [],
        status: 'blocked',
        sandbox: 'trusted_catalog',
        adminMenu: [],
        reason: 'Plugin is not in trusted catalog and was not loaded',
        rejectionCode: 'UNTRUSTED_CATALOG',
      },
    ])
  })

  it('reloads plugin metadata from KV after admin toggle', async () => {
    const store = new Map<string, string>()
    const kv = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value)
      }),
    } as unknown as KVNamespace
    const apiEnv = (await import('cloudflare:workers')).env as {
      CACHE: KVNamespace
      EDGE_PLUGINS_JSON: string
    }
    apiEnv.CACHE = kv
    apiEnv.EDGE_PLUGINS_JSON = JSON.stringify([{ name: 'audit-trace', enabled: true }])

    const pluginRegistryModule = await import(
      `../../plugins/plugin-registry?bypass=${Date.now()}`
    )
    const { pluginRegistry } = pluginRegistryModule
    mock.module('@/plugins/plugin-registry', () => ({
      ...pluginRegistryModule,
      pluginRegistry,
    }))

    const pluginLoaderModule = await import(
      `../../plugins/plugin-loader?bypass=${Date.now()}`
    )
    const { getLoadedPlugins, reloadConfiguredPlugins } = pluginLoaderModule
    mock.module('@/plugins/plugin-loader', () => ({
      ...pluginLoaderModule,
      getLoadedPlugins,
      reloadConfiguredPlugins,
    }))

    await reloadConfiguredPlugins(apiEnv.EDGE_PLUGINS_JSON, pluginRegistry, { kv })
    expect(getLoadedPlugins()[0]?.status).toBe('loaded')

    const { pluginsController } = await import(
      `../../plugins/plugins.controller?bypass=${Date.now()}`
    )
    const app = new Elysia().use(pluginsController)

    const patchResponse = await app.handle(
      new Request('http://localhost/api/admin/plugins/audit-trace', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
    )

    expect(patchResponse.status).toBe(200)
    expect(kv.put).toHaveBeenCalledWith('plugin:audit-trace:enabled', 'false')

    const getResponse = await app.handle(new Request('http://localhost/api/admin/plugins'))
    const body = (await getResponse.json()) as {
      data: Array<{ name: string; enabled: boolean; status: string }>
    }
    expect(body.data.find((plugin) => plugin.name === 'audit-trace')).toMatchObject({
      enabled: false,
      status: 'disabled',
    })
  })

  it('loads seo-metadata plugin with fields and AI tools', async () => {
    const pluginRegistryModule = await import(
      `../../plugins/plugin-registry?bypass=${Date.now()}`
    )
    const { pluginRegistry } = pluginRegistryModule

    mock.module('@/plugins/plugin-registry', () => ({
      ...pluginRegistryModule,
      pluginRegistry,
    }))

    const { loadPlugins, getLoadedPlugins, getLoadedPluginFields } = await import(
      `../../plugins/plugin-loader?bypass=${Date.now()}`
    )

    await loadPlugins([
      {
        name: 'seo-metadata',
        enabled: true,
      },
    ], pluginRegistry)

    const plugins = getLoadedPlugins()
    const seoPlugin = plugins.find((p: { name: string }) => p.name === 'seo-metadata')

    expect(seoPlugin).toBeDefined()
    expect(seoPlugin?.status).toBe('loaded')
    expect(seoPlugin?.metadata?.displayName).toBe('SEO Metadata')
    expect(seoPlugin?.adminMenu).toEqual([
      {
        label: 'SEO Metadata',
        path: '/settings/plugins/seo-metadata',
        group: 'Content',
      },
    ])
    expect(seoPlugin?.aiTools).toContain('pluginGenerateSeoMetadata')
    expect(seoPlugin?.routes).toContain('health')

    const fields = getLoadedPluginFields()
    const seoField = fields.find((f: { type: string }) => f.type === 'seo-preview')
    expect(seoField).toBeDefined()
    expect(seoField?.label).toBe('SEO Preview')
  })

  it('seo-metadata plugin has health route', async () => {
    const { getTrustedPluginDefinition } = await import(
      `../../plugins/trusted-plugin-catalog?bypass=${Date.now()}`
    )

    const definition = getTrustedPluginDefinition('seo-metadata')

    expect(definition).toBeDefined()
    expect(definition?.routes).toHaveProperty('health')
    expect(definition?.aiTools).toHaveLength(1)
    expect(definition?.aiTools?.[0].name).toBe('pluginGenerateSeoMetadata')
    expect(definition?.fields).toHaveLength(1)
    expect(definition?.fields?.[0].type).toBe('seo-preview')
  })

  afterAll(async () => {
    const actualLoader = await import('../../plugins/plugin-loader' as string)
    mock.module('@/plugins/plugin-loader', () => actualLoader)
    const actualRegistry = await import('../../plugins/plugin-registry' as string)
    mock.module('@/plugins/plugin-registry', () => actualRegistry)
  })
})
