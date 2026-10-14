import { env } from 'cloudflare:workers'
import { Elysia } from 'elysia'
import type { Env } from '@/env'
import type { Database } from '@/database/db'
import { hasTenantContext, resolveTenantBindings, type TenantContext } from './tenant-context'

export type TenantBindingsContext = {
  workerEnv: Env
  tenantCtx: TenantContext | undefined
  db: Database
  kv: KVNamespace
  r2: R2Bucket
}

/**
 * Elysia plugin that resolves worker environment bindings and tenant-scoped DB/KV/R2.
 * Injects `{ workerEnv, tenantCtx, db, kv, r2 }` into request context.
 */
export const withTenantBindings = new Elysia({ name: 'with-tenant-bindings' })
  .derive('plugin', (ctx): TenantBindingsContext => {
    const workerEnv = env as unknown as Env
    const store = (ctx as { store?: unknown }).store
    const tenantCtx = hasTenantContext(ctx)
      ? ctx.tenant
      : hasTenantContext(store)
        ? store.tenant
        : undefined
    const sessionBookmark =
      ctx.request?.headers?.get?.('x-d1-session') ??
      ctx.request?.headers?.get?.('x-session-bookmark') ??
      undefined
    const { db, kv, r2 } = resolveTenantBindings(
      tenantCtx,
      workerEnv,
      sessionBookmark ? { sessionBookmark } : undefined
    )
    return { workerEnv, tenantCtx, db, kv, r2 }
  })
