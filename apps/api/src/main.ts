import { createApp, warmPublicCacheInBackground } from './app'
import { bootstrapApp } from './runtime/bootstrap'
import { handleQueue } from '@/webhooks/queue-consumer'
import type { WebhookQueueMessage } from '@/webhooks/queue-producer'
import { getRequestUrl } from '@/shared/utils/request-url'
import type { Env } from './env'

const app = createApp()

let bootstrapped = false

export async function ensureWorkerBootstrapped(workerEnv?: Env): Promise<void> {
  if (bootstrapped) return
  bootstrapped = true
  await bootstrapApp({ env: workerEnv })
}

export function resetWorkerBootstrapStateForTests(): void {
  bootstrapped = false
}

const LIVE_HEALTH_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
}

const appFetch = app.fetch as (request: Request, ...args: unknown[]) => Promise<Response>

const worker = Object.assign(app, {
  async queue(batch: MessageBatch<WebhookQueueMessage>, env: Env, _ctx: ExecutionContext) {
    await ensureWorkerBootstrapped(env)
    return handleQueue(batch, env)
  },
  async fetch(request: Request, ...args: [any?, any?]) {
    const url = request.url
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      url.includes('/api/health/live') &&
      getRequestUrl(request).pathname === '/api/health/live'
    ) {
      if (request.method === 'HEAD') {
        return new Response(null, { headers: LIVE_HEALTH_HEADERS })
      }
      return new Response('{"status":"ok"}', { headers: LIVE_HEALTH_HEADERS })
    }
    const env = args[0] as Env | undefined
    const executionCtx = args[1] as ExecutionContext | undefined
    await ensureWorkerBootstrapped(env)
    warmPublicCacheInBackground(env, executionCtx)
    return appFetch(request, ...args)
  },
})

export default worker

// Export Durable Object classes
export { PublishScheduler } from '@/scheduling/publish-scheduler.do'

// Export queue consumer handler
export { handleQueue as queue } from '@/webhooks/queue-consumer'

// Backward-compatible type export for existing imports.
export type { Env } from './env'
