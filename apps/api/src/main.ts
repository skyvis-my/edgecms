import { createApp, warmPublicCacheInBackground } from './app'
import { ensureWorkerBootstrapped } from './runtime/bootstrap'
import { dispatchWebhookQueue } from '@/webhooks/queue-consumer'
import { runScheduledOutboxSweep } from '@/webhooks/outbox-sweeper'
import { runScheduledSideEffectSweep } from '@/commands/side-effect-sweep'
import { runScheduledAiImportCleanup } from '@/ai/import-retention-sweep'
import type { WebhookQueueMessage } from '@/webhooks/queue-producer'
import { getRequestUrl } from '@/shared/utils/request-url'
import type { Env } from './env'

export { ensureWorkerBootstrapped, resetWorkerBootstrapStateForTests } from './runtime/bootstrap'

export const app = createApp()

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

const worker = Object.create(app)
worker.queue = async (batch: MessageBatch<WebhookQueueMessage>, env: Env, _ctx: ExecutionContext) => {
  await ensureWorkerBootstrapped(env)
  return dispatchWebhookQueue(batch, env)
}
// DL-09: cron trigger (wrangler.toml [triggers]) drains the webhook outbox.
worker.scheduled = async (_controller: ScheduledController, env: Env, _ctx: ExecutionContext) => {
  await ensureWorkerBootstrapped(env)
  await runScheduledOutboxSweep(env)
  // CMD-06: retry post-commit side-effect intents even when no command arrives.
  await runScheduledSideEffectSweep(env)
  await runScheduledAiImportCleanup(env)
}
Object.defineProperty(worker, 'fetch', {
  value: async (request: Request, ...args: [any?, any?]) => {
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
  writable: true,
  configurable: true,
})

export default worker

// Export Durable Object classes
export { PublishScheduler } from '@/scheduling/publish-scheduler.do'

// Export queue consumer handler
export { dispatchWebhookQueue as queue } from '@/webhooks/queue-consumer'

// Backward-compatible type export for existing imports.
export type { Env } from './env'
