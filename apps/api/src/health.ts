import { env } from 'cloudflare:workers'
import type { Env } from '@/env'
import { API_VERSION } from '@/version'

export type SubsystemHealth = {
  status: 'ok' | 'missing' | 'error'
  latencyMs?: number
  error?: string
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy'
  timestamp: string
  version: string
  subsystems: {
    database: SubsystemHealth
    cache: SubsystemHealth
    media: SubsystemHealth
    assets: SubsystemHealth
    scheduler: SubsystemHealth
    webhooks: SubsystemHealth
  }
}

async function probeBinding<T>(
  binding: T | undefined,
  probeFn: (b: T) => Promise<void>
): Promise<SubsystemHealth> {
  if (!binding) return { status: 'missing' }
  const start = Date.now()
  try {
    await probeFn(binding)
    return { status: 'ok', latencyMs: Date.now() - start }
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

export async function buildHealthStatus(bindings?: {
  db?: D1Database
  kv?: KVNamespace
  r2?: R2Bucket
  assets?: R2Bucket
  scheduler?: DurableObjectNamespace
  webhooks?: Queue
}): Promise<HealthStatus> {
  // Use env bindings if not provided (for backward compatibility)
  const typedEnv = env as unknown as Env
  const db = bindings?.db ?? typedEnv.DB
  const kv = bindings?.kv ?? typedEnv.CACHE
  const r2 = bindings?.r2 ?? typedEnv.MEDIA
  const assets = bindings?.assets ?? typedEnv.ASSETS
  const scheduler = bindings?.scheduler ?? typedEnv.PUBLISH_SCHEDULER
  const webhooks = bindings?.webhooks ?? typedEnv.WEBHOOK_QUEUE

  const [database, cache, media, mediaAssets, sched, webhookQueue] = await Promise.all([
    probeBinding(db, async (d) => {
      await d.prepare('SELECT 1').first()
    }),
    probeBinding(kv, async (k) => {
      await k.get('__health_probe__')
    }),
    probeBinding(r2, async () => {
      // R2 binding exists - actual operations tested elsewhere
    }),
    probeBinding(assets, async () => {
      // Assets binding exists - actual operations tested elsewhere
    }),
    probeBinding(scheduler, async () => {
      // Scheduler is available if binding exists - just check presence
    }),
    probeBinding(webhooks, async () => {
      // Webhook queue is available if binding exists - just check presence
    }),
  ])

  const subsystems = {
    database,
    cache,
    media,
    assets: mediaAssets,
    scheduler: sched,
    webhooks: webhookQueue,
  }
  const statuses = Object.values(subsystems).map((s) => s.status)
  const hasError = statuses.includes('error')
  const hasMissing = statuses.includes('missing')

  return {
    status: hasError ? 'unhealthy' : hasMissing ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    version: API_VERSION,
    subsystems,
  }
}
