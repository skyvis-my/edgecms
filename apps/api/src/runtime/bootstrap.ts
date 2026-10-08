import { initializeWebhookProducerIfNeeded } from '@/commands/commands.controller'
import type { Env } from '@/env'
import {
  createCompositeMetricSink,
  createConsoleMetricSink,
  createKvMetricSink,
  setMetricSink,
} from '@/observability/metrics'
import {
  getLoadedPlugins,
  type PluginRuntime,
  reloadConfiguredPlugins,
} from '@/plugins/plugin-loader'
import { type PluginRegistry, pluginRegistry } from '@/plugins/plugin-registry'
import { eventBus } from '@/webhooks/event-bus'

async function resolveEnv(explicitEnv?: Env): Promise<Env> {
  if (explicitEnv) return explicitEnv
  try {
    const cf = await import('cloudflare:workers')
    return (cf.env ?? {}) as Env
  } catch {
    return {} as Env
  }
}

export function parsePluginHookTimeoutMs(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

export type BootstrapOptions = {
  env?: Env
  pluginRegistry?: PluginRegistry
  pluginRuntime?: PluginRuntime
  configureMetrics?: boolean
}

export type BootstrapResult = {
  bootstrapped: boolean
  pluginsLoaded: number
}

export async function bootstrapApp(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const targetEnv = await resolveEnv(options.env)
  if (!targetEnv.BETTER_AUTH_SECRET || targetEnv.BETTER_AUTH_SECRET.trim().length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be configured and at least 32 characters long')
  }

  if (options.configureMetrics !== false) {
    setMetricSink(
      createCompositeMetricSink(
        createConsoleMetricSink(),
        targetEnv.CACHE ? createKvMetricSink(targetEnv.CACHE) : undefined
      )
    )
  }

  const registry = options.pluginRegistry ?? options.pluginRuntime?.registry ?? pluginRegistry
  const configuredPluginHookTimeoutMs = parsePluginHookTimeoutMs(targetEnv.EDGE_PLUGIN_HOOK_TIMEOUT_MS)
  if (configuredPluginHookTimeoutMs !== undefined) {
    registry.setHookTimeoutMs(configuredPluginHookTimeoutMs)
  }

  if (options.pluginRuntime) {
    await options.pluginRuntime.reloadConfiguredPlugins(targetEnv.EDGE_PLUGINS_JSON, {
      kv: targetEnv.CACHE,
    })
  } else {
    await reloadConfiguredPlugins(targetEnv.EDGE_PLUGINS_JSON, registry, {
      kv: targetEnv.CACHE,
    })
  }

  initializeWebhookProducerIfNeeded(targetEnv, eventBus)

  return {
    bootstrapped: true,
    pluginsLoaded: getLoadedPlugins(options.pluginRuntime).length,
  }
}
