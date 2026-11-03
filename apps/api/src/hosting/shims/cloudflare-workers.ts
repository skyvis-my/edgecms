/**
 * Bun alias target for `cloudflare:workers` when running outside workerd.
 * See `apps/api/bunfig.hosting.toml`.
 */
import { getHostingEnv } from '../env-store'

export const env = new Proxy({} as Record<string, unknown>, {
  get(_target, prop) {
    const current = getHostingEnv() as unknown as Record<string | symbol, unknown>
    return current[prop]
  },
  set(_target, prop, value) {
    const current = getHostingEnv() as unknown as Record<string | symbol, unknown>
    current[prop] = value
    return true
  },
  has(_target, prop) {
    const current = getHostingEnv() as unknown as Record<string | symbol, unknown>
    return prop in current
  },
  ownKeys() {
    return Reflect.ownKeys(getHostingEnv() as object)
  },
  getOwnPropertyDescriptor(_target, prop) {
    const current = getHostingEnv() as unknown as Record<string | symbol, unknown>
    if (!(prop in current)) return undefined
    return {
      configurable: true,
      enumerable: true,
      writable: true,
      value: current[prop],
    }
  },
})
