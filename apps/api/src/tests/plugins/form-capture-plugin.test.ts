import { afterEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'

const {
  createLoadedPluginRoutesController,
  getLoadedPlugins,
  loadPlugins,
} = await import(`../../plugins/plugin-loader?bypass=${Date.now()}`)
const { pluginRegistry } = await import(`../../plugins/plugin-registry?bypass=${Date.now()}`)

describe('form-capture trusted plugin fixture', () => {
  afterEach(() => {
    pluginRegistry.clear()
  })

  it('keeps Form Capture deferred until public plugin namespace safety is approved', async () => {
    await loadPlugins([{ name: 'form-capture', enabled: true }], pluginRegistry)

    const app = new Elysia().use(createLoadedPluginRoutesController())
    const response = await app.handle(
      new Request('http://localhost/api/public/plugins/form-capture/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          formId: 'contact',
          email: 'user@example.com',
          fields: { msg: 'Hello' },
        }),
      })
    )

    expect(response.status).toBe(404)
    expect(getLoadedPlugins()[0]).toMatchObject({
      name: 'form-capture',
      enabled: true,
      hooks: [],
      routes: [],
      adminRoutes: [],
      publicRoutes: [],
      status: 'blocked',
      reason: 'Plugin is not in trusted catalog and was not loaded',
    })
  })
})
