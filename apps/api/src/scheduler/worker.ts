import type { Env } from '@/env'
import { sweepScheduleIntents } from '@/scheduling/schedule-intents.repository'
import { relayOutbox } from '@/webhooks/outbox-relay'
import { buildMessagesForEvent } from '@/webhooks/queue-producer'
import { sweepR2GcOutbox } from '@/assets/r2-gc.repository'
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

    const db = drizzle(env.DB)

    try {
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

    if (env.WEBHOOK_QUEUE) {
      try {
        const outboxResult = await relayOutbox(
          db as any,
          env.WEBHOOK_QUEUE as any,
          (event) => buildMessagesForEvent(db as any, event)
        )
        logger.info('scheduler_outbox_relay_completed', {
          relayed: outboxResult.relayed,
          pending: outboxResult.pending,
        })
      } catch (err) {
        logger.error('scheduler_outbox_relay_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    if (env.MEDIA) {
      try {
        const gcResult = await sweepR2GcOutbox(db as any, env.MEDIA)
        logger.info('scheduler_r2_gc_completed', {
          deleted: gcResult.deleted,
          failed: gcResult.failed,
        })
      } catch (err) {
        logger.error('scheduler_r2_gc_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  },

  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response(JSON.stringify({ status: 'ok', worker: 'edgecms-scheduler' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
