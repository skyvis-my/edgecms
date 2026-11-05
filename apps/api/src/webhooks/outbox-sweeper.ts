import { drizzle } from 'drizzle-orm/d1'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { loadEnabledWebhooks, relayOutbox, type ResolveOutboxMessages } from './outbox-relay'
import { outboxRepository } from './outbox.repository'
import { buildMessagesForEvent, type WebhookQueueMessage } from './queue-producer'

/**
 * Scheduled webhook outbox sweeper (DL-09).
 *
 * Runs from the API Worker's `scheduled()` cron handler. It drains outbox
 * rows the producer listener never closed (crash orphans, failed
 * sendBatch) without waiting for the next command. Work is bounded:
 * at most `maxTenants` tenant scopes, `perTenantLimit` rows per scope and
 * `maxRows` rows per tick. Rows younger than `staleOnlyMs` are left to the
 * producer listener. Each row is leased before it is sent (see
 * relayOutbox), so the sweep is safe to overlap with the engine's
 * post-execution sweep or another cron tick.
 */

export type OutboxSweepOptions = {
  maxTenants?: number
  perTenantLimit?: number
  maxRows?: number
  staleOnlyMs?: number
}

export type OutboxSweepResult = {
  tenants: number
  relayed: number
  pending: number
  dead: number
}

const DEFAULT_SWEEP: Required<OutboxSweepOptions> = {
  maxTenants: 25,
  perTenantLimit: 20,
  maxRows: 200,
  staleOnlyMs: 60_000,
}

export async function sweepOutbox(
  db: Database,
  queue: Queue<WebhookQueueMessage>,
  resolveMessages: ResolveOutboxMessages,
  options: OutboxSweepOptions = {}
): Promise<OutboxSweepResult> {
  const opts = { ...DEFAULT_SWEEP, ...options }
  const result: OutboxSweepResult = { tenants: 0, relayed: 0, pending: 0, dead: 0 }

  let scopes: string[]
  try {
    scopes = await outboxRepository.listDueTenantScopes(db, opts.maxTenants, {
      staleOnlyMs: opts.staleOnlyMs,
    })
  } catch (err) {
    logger.warn('webhook_outbox_sweep_scopes_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return result
  }
  if (scopes.length === 0) return result

  const enabledWebhooks = await loadEnabledWebhooks(db)
  let budget = opts.maxRows
  for (const tenantScope of scopes) {
    if (budget <= 0) break
    const limit = Math.min(opts.perTenantLimit, budget)
    const relay = await relayOutbox(db, queue, resolveMessages, {
      limit,
      staleOnlyMs: opts.staleOnlyMs,
      tenantScope,
      enabledWebhooks,
    })
    result.tenants++
    result.relayed += relay.relayed
    result.pending += relay.pending
    result.dead += relay.dead
    budget -= relay.relayed + relay.pending + relay.dead
  }
  return result
}

/**
 * Worker `scheduled()` entry: sweep the outbox through WEBHOOK_QUEUE.
 * Returns null (and does nothing) when DB or the queue is not bound.
 */
export async function runScheduledOutboxSweep(
  env: Env,
  options?: OutboxSweepOptions
): Promise<OutboxSweepResult | null> {
  if (!env?.DB || !env.WEBHOOK_QUEUE) {
    logger.info('webhook_outbox_sweep_skipped', {
      reason: env?.DB ? 'no_webhook_queue' : 'no_db',
    })
    return null
  }
  const db = drizzle(env.DB) as unknown as Database
  try {
    const result = await sweepOutbox(
      db,
      env.WEBHOOK_QUEUE as Queue<WebhookQueueMessage>,
      (event, cached) =>
        buildMessagesForEvent(db, event, cached as Parameters<typeof buildMessagesForEvent>[2]),
      options
    )
    logger.info('webhook_outbox_sweep_completed', result)
    return result
  } catch (err) {
    logger.error('webhook_outbox_sweep_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
