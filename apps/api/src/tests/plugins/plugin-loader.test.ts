import { afterEach, describe, expect, it, vi } from 'bun:test'
import { type } from 'arktype'
import { Elysia } from 'elysia'
import type { TrustedPluginDefinition } from '../../plugins/trusted-plugin-catalog'

// Use cache-busted dynamic imports to avoid mock pollution from other test files
const {
  createLoadedPluginRoutesController,
  getLoadedPluginAiTools,
  getLoadedPlugins,
  loadPlugins,
  parsePluginConfig,
} = await import(`../../plugins/plugin-loader?bypass=${Date.now()}`)
const { pluginRegistry } = await import(`../../plugins/plugin-registry?bypass=${Date.now()}`)

function asTrustedDefinition({
  hooks,
  aiTools = [],
  routes = {},
  metadata,
  adminMenu = [],
}: TrustedPluginDefinition) {
  return { hooks, aiTools, routes, metadata, adminMenu }
}

describe('loadPlugins', () => {
  afterEach(() => {
    pluginRegistry.clear()
  })

  it('loads plugins and registers hooks', async () => {
    const beforeCommand = vi.fn()
    const afterCommand = vi.fn()

    const registry = await loadPlugins([
      {
        name: 'trusted-plugin',
      },
    ], pluginRegistry, (name: string) =>
      name === 'trusted-plugin'
        ? asTrustedDefinition({
            hooks: {
              beforeCommand,
              afterCommand,
            },
          })
        : undefined
    )

    expect(registry).toBeDefined()

    await registry.execute('beforeCommand', {
      requestId: 'r1',
      pathname: '/api/admin/commands',
      method: 'POST',
    })
    await registry.execute('afterCommand', {
      requestId: 'r1',
      pathname: '/api/admin/commands',
      method: 'POST',
    })

    expect(beforeCommand).toHaveBeenCalledTimes(1)
    expect(afterCommand).toHaveBeenCalledTimes(1)
  })

  it('parses plugin manifests from json config', () => {
    const manifests = parsePluginConfig(
      JSON.stringify([
        { name: '  plugin-a  ' },
        { name: 'plugin-b', enabled: false },
        { name: '   ' },
        { bad: true },
      ])
    )

    expect(manifests).toEqual([
      { name: 'plugin-a', enabled: true },
      { name: 'plugin-b', enabled: false },
    ])
  })

  it('returns empty plugin manifests for invalid json', () => {
    expect(parsePluginConfig('not-json')).toEqual([])
  })

  it('tracks loaded plugin metadata for admin visibility', async () => {
    await loadPlugins([
      {
        name: 'trusted-enabled-plugin',
        enabled: true,
      },
      {
        name: 'trusted-disabled-plugin',
        enabled: false,
      },
      {
        name: 'untrusted-plugin',
        enabled: true,
      },
    ], pluginRegistry, (name: string) =>
      name.startsWith('trusted-')
        ? asTrustedDefinition({
            hooks: {
              beforeCommand: async () => {},
            },
          })
        : undefined
    )

    expect(getLoadedPlugins()).toEqual([
      {
        name: 'trusted-enabled-plugin',
        enabled: true,
        hooks: ['beforeCommand'],
        aiTools: [],
        routes: [],
        adminRoutes: [],
        publicRoutes: [],
        status: 'loaded',
        sandbox: 'trusted_catalog',
        adminMenu: [],
      },
      {
        name: 'trusted-disabled-plugin',
        enabled: false,
        hooks: ['beforeCommand'],
        aiTools: [],
        routes: [],
        adminRoutes: [],
        publicRoutes: [],
        status: 'disabled',
        sandbox: 'trusted_catalog',
        adminMenu: [],
      },
      {
        name: 'untrusted-plugin',
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

  it('preserves configured hook timeout across plugin reloads', async () => {
    pluginRegistry.setHookTimeoutMs(900)

    await loadPlugins([
      {
        name: 'trusted-timeout-safe-plugin',
        enabled: true,
      },
    ], pluginRegistry, (name: string) =>
      name === 'trusted-timeout-safe-plugin'
        ? asTrustedDefinition({
            hooks: {
              beforeCommand: async () => {},
            },
          })
        : undefined
    )

    expect(pluginRegistry.getHookTimeoutMs()).toBe(900)
  })

  it('honors KV disabled state while loading enabled manifests', async () => {
    const beforeCommand = vi.fn()
    const kv = {
      get: vi.fn(async (key: string) =>
        key === 'plugin:trusted-kv-disabled-plugin:enabled' ? 'false' : null
      ),
    } as unknown as KVNamespace

    const registry = await loadPlugins(
      [
        {
          name: 'trusted-kv-disabled-plugin',
          enabled: true,
        },
      ],
      pluginRegistry,
      (name: string) =>
        name === 'trusted-kv-disabled-plugin'
          ? asTrustedDefinition({
              hooks: {
                beforeCommand,
              },
            })
          : undefined,
      { kv }
    )

    expect(getLoadedPlugins()[0]).toMatchObject({
      name: 'trusted-kv-disabled-plugin',
      enabled: false,
      status: 'disabled',
      hooks: ['beforeCommand'],
    })

    await registry.execute('beforeCommand', {
      requestId: 'r1',
      pathname: '/api/admin/commands',
      method: 'POST',
    })
    expect(beforeCommand).not.toHaveBeenCalled()
  })

  it('exposes plugin AI tools and routes after loading trusted plugins', async () => {
    await loadPlugins(
      [
        {
          name: 'trusted-extensibility-plugin',
          enabled: true,
        },
      ],
      pluginRegistry,
      (name: string) =>
        name === 'trusted-extensibility-plugin'
          ? asTrustedDefinition({
              hooks: {},
              aiTools: [
                {
                  name: 'pluginUpdateEntry',
                  description: 'Plugin tool wrapper for updateEntry',
                  parameters: type({ id: 'string', data: 'Record<string, unknown>' }),
                  toCommands: (args) => [{ type: 'updateEntry', payload: args }],
                },
              ],
              routes: {
                health: () =>
                  new Elysia().get('/api/admin/plugins/trusted-extensibility-plugin/health', () => ({ ok: true })) as any,
              },
            })
          : undefined
    )

    const aiTools = getLoadedPluginAiTools()
    expect(aiTools).toHaveLength(1)
    expect(aiTools[0]?.name).toBe('pluginUpdateEntry')

    const app = new Elysia().use(createLoadedPluginRoutesController())
    const routeResponse = await app.handle(
      new Request('http://localhost/api/admin/plugins/trusted-extensibility-plugin/health')
    )
    expect(routeResponse.status).toBe(200)
    expect(await routeResponse.json()).toEqual({ ok: true })
  })

  it('blocks trusted public plugin routes until the public namespace has tenant safety tests', async () => {
    await loadPlugins(
      [
        {
          name: 'public-route-plugin',
          enabled: true,
        },
      ],
      pluginRegistry,
      (name: string) =>
        name === 'public-route-plugin'
          ? asTrustedDefinition({
              hooks: {},
              routes: {
                submit: () =>
                  new Elysia().post('/api/public/plugins/public-route-plugin/submit', () => ({
                    ok: true,
                  })) as any,
                adminHealth: () =>
                  new Elysia().get('/api/admin/plugins/public-route-plugin/health', () => ({
                    ok: true,
                  })) as any,
              },
            })
          : undefined
    )

    const app = new Elysia().use(createLoadedPluginRoutesController())
    const publicResponse = await app.handle(
      new Request('http://localhost/api/public/plugins/public-route-plugin/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    )
    const adminResponse = await app.handle(
      new Request('http://localhost/api/admin/plugins/public-route-plugin/health')
    )

    expect(publicResponse.status).toBe(404)
    expect(adminResponse.status).toBe(200)
    expect(getLoadedPlugins()[0]).toMatchObject({
      routes: ['adminHealth'],
      adminRoutes: ['adminHealth'],
      publicRoutes: [],
      reason: 'Blocked unsandboxed plugin routes: submit',
    })
  })

  it('blocks public plugin routes even when mounted under a tenant route group', async () => {
    await loadPlugins(
      [
        {
          name: 'tenant-public-plugin',
          enabled: true,
        },
      ],
      pluginRegistry,
      (name: string) =>
        name === 'tenant-public-plugin'
          ? asTrustedDefinition({
              hooks: {},
              routes: {
                tenantProbe: () =>
                  new Elysia().get('/api/public/plugins/tenant-public-plugin/probe', (ctx) => ({
                    tenantSlug: (ctx as { tenant?: { tenant: { slug: string } } }).tenant?.tenant.slug,
                  })) as any,
              },
            })
          : undefined
    )

    const app = new Elysia().group('/api/tenants/:tenantSlug', (tenantApp) =>
      tenantApp
        .derive(({ params }) => ({
          tenant: { tenant: { slug: params.tenantSlug } },
        }))
        .use(createLoadedPluginRoutesController())
    )
    const response = await app.handle(
      new Request('http://localhost/api/tenants/acme/api/public/plugins/tenant-public-plugin/probe')
    )

    expect(response.status).toBe(404)
    expect(getLoadedPlugins()[0]).toMatchObject({
      routes: [],
      adminRoutes: [],
      publicRoutes: [],
      reason: 'Blocked unsandboxed plugin routes: tenantProbe',
    })
  })

  it('blocks plugin routes that escape the plugin namespace sandbox', async () => {
    await loadPlugins(
      [{ name: 'route-escape-plugin', enabled: true }],
      pluginRegistry,
      (name: string) =>
        name === 'route-escape-plugin'
          ? asTrustedDefinition({
              hooks: {},
              routes: {
                escapedHealth: () => new Elysia().get('/plugin-route-health', () => ({ ok: true })) as any,
              },
            })
          : undefined
    )

    const app = new Elysia().use(createLoadedPluginRoutesController())
    const routeResponse = await app.handle(new Request('http://localhost/plugin-route-health'))
    expect(routeResponse.status).toBe(404)

    const loaded = getLoadedPlugins()
    expect(loaded[0]?.status).toBe('loaded')
    expect(loaded[0]?.routes).toEqual([])
    expect(loaded[0]?.adminRoutes).toEqual([])
    expect(loaded[0]?.publicRoutes).toEqual([])
    expect(loaded[0]?.reason).toContain('Blocked unsandboxed plugin routes')
  })

  it('isolates throwing plugin route factories during load', async () => {
    await loadPlugins(
      [{ name: 'throwing-route-plugin', enabled: true }],
      pluginRegistry,
      (name: string) =>
        name === 'throwing-route-plugin'
          ? asTrustedDefinition({
              hooks: {},
              routes: {
                broken: () => {
                  throw new Error('route factory failed')
                },
              },
            })
          : undefined
    )

    const loaded = getLoadedPlugins()
    expect(loaded[0]?.status).toBe('loaded')
    expect(loaded[0]?.routes).toEqual([])
    expect(loaded[0]?.adminRoutes).toEqual([])
    expect(loaded[0]?.publicRoutes).toEqual([])
    expect(loaded[0]?.reason).toContain('Blocked unsandboxed plugin routes: broken')
  })

  it('copies trusted catalog metadata and safe admin menu descriptors', async () => {
    await loadPlugins(
      [{ name: 'catalog-ui-plugin', enabled: true }],
      pluginRegistry,
      (name: string) =>
        name === 'catalog-ui-plugin'
          ? asTrustedDefinition({
              metadata: {
                displayName: 'Catalog UI',
                description: 'Trusted catalog metadata for admin display',
                version: '1.2.3',
                category: 'content',
              },
              hooks: {},
              adminMenu: [
                {
                  label: 'Catalog UI',
                  path: '/settings/plugins/catalog-ui-plugin',
                  group: 'Content',
                },
              ],
            })
          : undefined
    )

    expect(getLoadedPlugins()[0]).toMatchObject({
      name: 'catalog-ui-plugin',
      metadata: {
        displayName: 'Catalog UI',
        description: 'Trusted catalog metadata for admin display',
        version: '1.2.3',
        category: 'content',
      },
      adminMenu: [
        {
          label: 'Catalog UI',
          path: '/settings/plugins/catalog-ui-plugin',
          group: 'Content',
        },
      ],
    })
  })

  it('ignores manifest-provided metadata and admin menu for untrusted plugins', async () => {
    const manifests = parsePluginConfig(
      JSON.stringify([
        {
          name: 'untrusted-plugin',
          metadata: { displayName: 'Forged' },
          adminMenu: [{ label: 'Unsafe', path: 'https://evil.example' }],
        },
      ])
    )

    await loadPlugins(manifests, pluginRegistry, () => undefined)

    expect(manifests).toEqual([{ name: 'untrusted-plugin', enabled: true }])
    expect(getLoadedPlugins()[0]).toEqual({
      name: 'untrusted-plugin',
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
    })
  })

  it('blocks unsafe trusted plugin admin menu descriptors', async () => {
    await loadPlugins(
      [{ name: 'unsafe-menu-plugin', enabled: true }],
      pluginRegistry,
      (name: string) =>
        name === 'unsafe-menu-plugin'
          ? asTrustedDefinition({
              hooks: {},
              adminMenu: [
                { label: 'Safe', path: '/settings/plugins/unsafe-menu-plugin' },
                { label: 'External', path: 'https://evil.example' },
              ],
            })
          : undefined
    )

    const loaded = getLoadedPlugins()[0]
    expect(loaded?.adminMenu).toEqual([
      { label: 'Safe', path: '/settings/plugins/unsafe-menu-plugin' },
    ])
    expect(loaded?.reason).toContain('Blocked unsafe plugin admin menu items: External')
  })

  it('isolates plugin AI tool arguments from host state via sandbox cloning', async () => {
    await loadPlugins(
      [{ name: 'isolated-ai-plugin', enabled: true }],
      pluginRegistry,
      (name: string) =>
        name === 'isolated-ai-plugin'
          ? asTrustedDefinition({
              hooks: {},
              aiTools: [
                {
                  name: 'mutatingTool',
                  description: 'Tries to mutate incoming args',
                  parameters: type({ id: 'string', data: 'Record<string, unknown>' }),
                  toCommands: (args) => {
                    ;(args as Record<string, unknown>).id = 'mutated-id'
                    return [{ type: 'updateEntry', payload: args }]
                  },
                },
              ],
            })
          : undefined
    )

    const [tool] = getLoadedPluginAiTools()
    expect(tool?.name).toBe('mutatingTool')
    const input = { id: 'entry-1', data: { title: 'Original' } }
    expect(() => tool?.toCommands(input)).toThrow()

    expect(input).toEqual({ id: 'entry-1', data: { title: 'Original' } })
  })

  it('loads preview revalidation with signed admin dry-run route and no public route', async () => {
    await loadPlugins([{ name: 'preview-revalidation', enabled: true }], pluginRegistry)

    const plugin = getLoadedPlugins()[0]
    expect(plugin).toMatchObject({
      name: 'preview-revalidation',
      status: 'loaded',
      routes: ['health', 'dryRun'],
      adminRoutes: ['health', 'dryRun'],
      publicRoutes: [],
    })

    const app = new Elysia().use(createLoadedPluginRoutesController())
    const res = await app.handle(
      new Request('http://localhost/api/admin/plugins/preview-revalidation/dry-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          destination: 'https://frontend.example.com/api/revalidate',
          secret: 'preview-secret',
          path: '/blog/launch',
          event: 'entry.published',
        }),
      })
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: true
      data: {
        destination: string
        method: string
        headers: Record<string, string>
        payload: { event: string; path: string }
        secret?: string
      }
    }
    expect(body.data.destination).toBe('https://frontend.example.com/api/revalidate')
    expect(body.data.method).toBe('POST')
    expect(body.data.payload).toMatchObject({
      event: 'entry.published',
      path: '/blog/launch',
    })
    expect(body.data.headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(body.data.secret).toBeUndefined()

    const publicRes = await app.handle(
      new Request('http://localhost/api/public/plugins/preview-revalidation/dry-run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    )
    expect(publicRes.status).toBe(404)
  })
})
