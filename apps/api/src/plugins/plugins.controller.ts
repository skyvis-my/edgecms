import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import type { Env } from '@/env'
import { getLoadedPlugins, type PluginRuntime, reloadConfiguredPlugins } from './plugin-loader'
import { pluginRegistry } from './plugin-registry'

export function createPluginsController(runtime?: PluginRuntime) {
  return new Elysia({ prefix: '/api/admin/plugins' })
    .use(betterAuthPlugin)
    .get(
      '/',
      () => ({
        success: true as const,
        data: getLoadedPlugins(runtime),
      }),
      { auth: true }
    )
    .patch(
      '/:pluginName',
      async ({ params, body }) => {
        const { pluginName } = params
        const { enabled } = body
        const apiEnv = env as Env
        const kv = apiEnv.CACHE

        const reg = runtime?.registry ?? pluginRegistry
        await reg.setPluginEnabled(kv, pluginName, enabled)
        if (runtime) {
          await runtime.reloadConfiguredPlugins(apiEnv.EDGE_PLUGINS_JSON, { kv })
        } else {
          await reloadConfiguredPlugins(apiEnv.EDGE_PLUGINS_JSON, reg, { kv })
        }

        return {
          success: true as const,
          data: { pluginName, enabled },
        }
      },
      {
        auth: true,
        body: t.Object({
          enabled: t.Boolean(),
        }),
      }
    )
}

export const pluginsController = createPluginsController()
