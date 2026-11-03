import type { Env } from '@/env'

/**
 * Mutable Worker-shaped env used by the Node/Bun hosting path.
 * Controllers still `import { env } from 'cloudflare:workers'`; the hosting
 * shim resolves that module to this store (see `shims/cloudflare-workers.ts`
 * and `bunfig.hosting.toml`).
 */
const store: { current: Env } = {
  current: {} as Env,
}

export function getHostingEnv(): Env {
  return store.current
}

export function setHostingEnv(next: Env): void {
  store.current = next
}

export function patchHostingEnv(patch: Partial<Env>): Env {
  store.current = { ...store.current, ...patch } as Env
  return store.current
}
