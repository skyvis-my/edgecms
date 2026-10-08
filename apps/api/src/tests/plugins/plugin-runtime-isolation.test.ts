import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'

import {
  createPluginRuntime,
  getLoadedPlugins,
  reloadConfiguredPlugins,
} from '@/plugins/plugin-loader'

describe('F06 — Plugin runtime isolation', () => {
  it('creates isolated runtime instances where loading app B does not clear or mutate app A', async () => {
    const runtimeA = createPluginRuntime()
    const runtimeB = createPluginRuntime()

    // App A loads preview-revalidation
    await runtimeA.loadPlugins([{ name: 'preview-revalidation', enabled: true }])

    // Verify App A has preview-revalidation loaded
    const pluginsA1 = runtimeA.getLoadedPlugins()
    expect(pluginsA1).toHaveLength(1)
    expect(pluginsA1[0]?.name).toBe('preview-revalidation')
    expect(pluginsA1[0]?.status).toBe('loaded')

    // Mount App A routes controller
    const appA = new Elysia().use(runtimeA.createLoadedPluginRoutesController())
    const resA1 = await appA.handle(
      new Request('http://localhost/api/admin/plugins/preview-revalidation/health')
    )
    expect(resA1.status).toBe(200)

    // Now App B loads seo-metadata (a different plugin)
    await runtimeB.loadPlugins([{ name: 'seo-metadata', enabled: true }])

    // Verify App B has seo-metadata
    const pluginsB = runtimeB.getLoadedPlugins()
    expect(pluginsB).toHaveLength(1)
    expect(pluginsB[0]?.name).toBe('seo-metadata')
    expect(pluginsB[0]?.status).toBe('loaded')
    expect(runtimeB.getLoadedPluginFields()).toHaveLength(1)

    // App B routes controller has seo-metadata route
    const appB = new Elysia().use(runtimeB.createLoadedPluginRoutesController())
    const resB = await appB.handle(
      new Request('http://localhost/api/admin/plugins/seo-metadata/health')
    )
    expect(resB.status).toBe(200)

    // CRITICAL ISOLATION ASSERTIONS:
    // App A must NOT be affected by App B's loading!
    // App A still has preview-revalidation and NOT seo-metadata
    const pluginsA2 = runtimeA.getLoadedPlugins()
    expect(pluginsA2).toHaveLength(1)
    expect(pluginsA2[0]?.name).toBe('preview-revalidation')
    expect(runtimeA.getLoadedPluginFields()).toHaveLength(0)

    // App A still serves preview-revalidation
    const resA2 = await appA.handle(
      new Request('http://localhost/api/admin/plugins/preview-revalidation/health')
    )
    expect(resA2.status).toBe(200)

    // App A does NOT serve App B's routes
    const resA_BRoute = await appA.handle(
      new Request('http://localhost/api/admin/plugins/seo-metadata/health')
    )
    expect(resA_BRoute.status).toBe(404)

    // App B does NOT serve App A's routes
    const resB_ARoute = await appB.handle(
      new Request('http://localhost/api/admin/plugins/preview-revalidation/health')
    )
    expect(resB_ARoute.status).toBe(404)

    // App B reloading with empty config does NOT clear App A
    await runtimeB.reloadConfiguredPlugins('[]')
    expect(runtimeB.getLoadedPlugins()).toHaveLength(0)

    const pluginsA3 = runtimeA.getLoadedPlugins()
    expect(pluginsA3).toHaveLength(1)
    expect(pluginsA3[0]?.name).toBe('preview-revalidation')
  })

  it('isolates hook timeouts and hook execution between runtime registries', async () => {
    const runtimeA = createPluginRuntime()
    const runtimeB = createPluginRuntime()

    runtimeA.registry.setHookTimeoutMs(50)
    runtimeB.registry.setHookTimeoutMs(500)

    expect(runtimeA.registry.getHookTimeoutMs()).toBe(50)
    expect(runtimeB.registry.getHookTimeoutMs()).toBe(500)

    let hookACalled = false
    let hookBCalled = false

    runtimeA.registry.register('beforeCommand', async () => {
      hookACalled = true
    })
    runtimeB.registry.register('beforeCommand', async () => {
      hookBCalled = true
    })

    await runtimeA.registry.execute('beforeCommand', {
      requestId: 'r1',
      pathname: '/api/admin/commands',
      method: 'POST',
      commandId: 'c1',
      commandType: 'create_entry',
    })

    expect(hookACalled).toBe(true)
    expect(hookBCalled).toBe(false)
  })

  it('preserves legacy singleton delegation to defaultPluginRuntime', async () => {
    await reloadConfiguredPlugins('[{"name":"preview-revalidation","enabled":true}]')
    const plugins = getLoadedPlugins()
    expect(plugins.some((p: { name: string }) => p.name === 'preview-revalidation')).toBe(true)
  })

  it('clears loaded plugins and routes via runtime.clear()', async () => {
    const runtime = createPluginRuntime()
    await runtime.loadPlugins([{ name: 'preview-revalidation', enabled: true }])
    expect(runtime.getLoadedPlugins()).toHaveLength(1)

    runtime.clear()
    expect(runtime.getLoadedPlugins()).toHaveLength(0)
    expect(runtime.getLoadedPluginAiTools()).toHaveLength(0)
    expect(runtime.getLoadedPluginFields()).toHaveLength(0)
  })
})
