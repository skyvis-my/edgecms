import type { Env } from '@/env'
import { sweepScheduleIntents } from '@/scheduling/schedule-intents.repository'
import { logger } from '@/observability/logger'
import { drizzle } from 'drizzle-orm/d1'

/**
 * Cloudflare Worker entrypoint for scheduled cron execution.
 *
 * Primary scheduling is managed via Durable Object alarms (`PublishScheduler`
 * in `edgecms-api`). This standalone cron worker acts as an optional scheduled
 * sweeper that periodically reconciles any orphaned schedule intents.
 */
export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx?: ExecutionContext
  ): Promise<void> {
    logger.info('scheduler_cron_tick', {
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    })
    if (!env?.DB) {
      logger.error('scheduler_sweep_missing_db', {})
      return
    }
    try {
      const db = drizzle(env.DB)
      const result = await sweepScheduleIntents(db as any, env, { limit: 50 })
      logger.info('scheduler_sweep_completed', {
        claimed: result.claimed,
        notified: result.notified,
        cancelled: result.cancelled,
        stale: result.stale,
        failed: result.failed,
      })
    } catch (err) {
      logger.error('scheduler_sweep_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response(JSON.stringify({ status: 'ok', worker: 'edgecms-scheduler' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
