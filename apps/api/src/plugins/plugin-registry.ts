import type { HookName, PluginHook, PluginHookContext } from '@edgecms/plugin-sdk'
import { incrementMetric } from '@/observability/metrics'

export type { HookName }
const DEFAULT_HOOK_TIMEOUT_MS = 250

export class PluginRegistry {
  private hooks = new Map<HookName, PluginHook[]>()
  private hookTimeoutMs = DEFAULT_HOOK_TIMEOUT_MS

  register(hook: HookName, handler: PluginHook) {
    const handlers = this.hooks.get(hook) ?? []
    handlers.push(handler)
    this.hooks.set(hook, handlers)
  }

  setHookTimeoutMs(timeoutMs: number) {
    this.hookTimeoutMs = Math.max(0, Math.floor(timeoutMs))
  }

  getHookTimeoutMs() {
    return this.hookTimeoutMs
  }

  private async executeHookWithTimeout(
    hook: HookName,
    handler: PluginHook,
    ctx: PluginHookContext
  ) {
    const hookContext = Object.freeze({ ...ctx })
    try {
      if (this.hookTimeoutMs <= 0) {
        await handler(hookContext)
      } else {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            handler(hookContext),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                reject(new Error(`Plugin hook timed out after ${this.hookTimeoutMs}ms`))
              }, this.hookTimeoutMs)
            }),
          ])
        } finally {
          if (timer) clearTimeout(timer)
        }
      }
      incrementMetric('plugin_hook_runs_total', { hook, status: 'success' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status = message.includes('timed out') ? 'timeout' : 'failed'
      incrementMetric('plugin_hook_runs_total', { hook, status })
      throw err
    }
  }

  async execute(hook: HookName, ctx: PluginHookContext) {
    const handlers = this.hooks.get(hook) ?? []
    for (const handler of handlers) {
      await this.executeHookWithTimeout(hook, handler, ctx)
    }
  }

  async isPluginEnabled(kv: KVNamespace, pluginName: string): Promise<boolean> {
    const raw = await kv.get(`plugin:${pluginName}:enabled`)
    if (raw === null) return true // enabled by default
    return JSON.parse(raw) === true
  }

  async setPluginEnabled(kv: KVNamespace, pluginName: string, enabled: boolean): Promise<void> {
    await kv.put(`plugin:${pluginName}:enabled`, JSON.stringify(enabled))
  }

  clear() {
    this.hooks.clear()
    this.hookTimeoutMs = DEFAULT_HOOK_TIMEOUT_MS
  }
}

export function createPluginRegistry(initialTimeoutMs?: number): PluginRegistry {
  const registry = new PluginRegistry()
  if (typeof initialTimeoutMs === 'number') {
    registry.setHookTimeoutMs(initialTimeoutMs)
  }
  return registry
}

export const pluginRegistry = createPluginRegistry()
;(pluginRegistry as any).createRegistry = createPluginRegistry

