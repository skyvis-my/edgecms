import { logger } from '@/observability/logger'
import type { Database } from '@/database/db'
import type { EventType, WebhookEvent } from './event-bus'
import { outboxRepository, type OutboxRow } from './outbox.repository'
import type { WebhookQueueMessage } from './queue-producer'

/**
 * Webhook outbox relay (H1 recovery path).
 *
 * The command engine writes outbox rows atomically with the command commit.
 * The happy path is closed by the queue producer, which marks the row sent
 * after a successful queue.sendBatch (linked via metadata.outboxEventId).
 * Rows still pending afterwards are crash orphans (or sendBatch failures);
 * this relay replays them.
 *
 * Two usages:
 * - engine post-execution calls relayOutbox() with staleOnlyMs=60s as a
 *   best-effort opportunistic sweep (never touches fresh rows the producer
 *   listener is about to send, so no duplicate sends).
 * - the Worker scheduled() cron (outbox-sweeper.ts) calls it per tenant
 *   scope in bounded batches, also with staleOnlyMs=60s.
 *
 * Each claimed row is leased (conditional UPDATE) before it is sent, so
 * overlapping relays send a row at most once. Failures back off
 * exponentially with jitter; after OUTBOX_MAX_ATTEMPTS the row is 'dead'.
 *
 * Subscription resolution is injected via callback to avoid circular imports:
 * the producer passes (event) => buildMessagesForEvent(db, event).
 */

import { eq } from 'drizzle-orm'
import { webhooks } from '@/database/schema/webhooks.schema'

export type ResolveOutboxMessages = (
  event: WebhookEvent,
  cachedWebhooks?: unknown[]
) => Promise<WebhookQueueMessage[]>

const RELAY_SEND_BATCH_SIZE = 100
/** Relay attempts before an outbox row moves to the terminal 'dead' state. */
export const OUTBOX_MAX_ATTEMPTS = 8
const OUTBOX_RETRY_BASE_MS = 60_000
const OUTBOX_RETRY_MAX_MS = 60 * 60_000
/** How long a relay holds a claimed row before another relay may take it. */
const OUTBOX_LEASE_MS = 5 * 60_000

/**
 * Exponential backoff with equal jitter: the cap doubles per attempt from
 * 60 s up to one hour, and the delay is uniform in [cap/2, cap].
 */
export function computeOutboxRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : 1
  const cap = Math.min(OUTBOX_RETRY_MAX_MS, OUTBOX_RETRY_BASE_MS * 2 ** Math.min(n - 1, 30))
  const half = cap / 2
  const r = Math.min(1, Math.max(0, random()))
  return Math.floor(half + r * half)
}

export type OutboxRelayResult = { relayed: number; pending: number; dead: number }

function toWebhookEvent(row: OutboxRow): WebhookEvent {
  const payload = (row.payload ?? {}) as {
    event?: EventType
    metadata?: unknown
    after?: unknown
    before?: unknown
  }
  return {
    id: row.eventId,
    event: payload.event ?? (row.eventType as EventType),
    timestamp: row.createdAt,
    data: {
      before: payload.before ?? null,
      after: payload.after,
      metadata: payload.metadata,
    },
  }
}

/**
 * Claim due outbox rows and send each through the queue. Marks rows sent on
 * success; on sendBatch failure leaves the row pending with exponential
 * backoff, or moves it to 'dead' once OUTBOX_MAX_ATTEMPTS is reached.
 * Never throws — per-row failures are contained.
 */
export async function relayOutbox(
  db: Database,
  queue?: Queue<WebhookQueueMessage> | null,
  resolveMessages?: ResolveOutboxMessages | null,
  opts?: {
    limit?: number
    staleOnlyMs?: number
    tenantScope?: string
    maxAttempts?: number
    /** Enabled webhook rows already loaded by the caller (sweeper prefetch). */
    enabledWebhooks?: unknown[]
  }
): Promise<OutboxRelayResult> {
  const empty = { relayed: 0, pending: 0, dead: 0 }
  if (!queue) return empty
  let claimed: OutboxRow[]
  try {
    claimed = await outboxRepository.claimPending(db, opts?.limit ?? 20, {
      staleOnlyMs: opts?.staleOnlyMs,
      tenantScope: opts?.tenantScope,
    })
  } catch (err) {
    logger.warn('webhook_outbox_claim_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return empty
  }
  if (claimed.length === 0) return empty

  let enabledWebhooks: unknown[] | undefined = opts?.enabledWebhooks
  if (resolveMessages && !enabledWebhooks) {
    enabledWebhooks = await loadEnabledWebhooks(db)
  }

  const maxAttempts = opts?.maxAttempts ?? OUTBOX_MAX_ATTEMPTS
  let relayed = 0
  let dead = 0
  let skipped = 0
  for (const row of claimed) {
    try {
      const leased = await outboxRepository.lease(
        db,
        row.eventId,
        new Date(Date.now() + OUTBOX_LEASE_MS).toISOString()
      )
      if (!leased) {
        skipped++
        continue
      }
    } catch (err) {
      logger.warn('webhook_outbox_lease_failed', {
        eventId: row.eventId,
        error: err instanceof Error ? err.message : String(err),
      })
      skipped++
      continue
    }
    const event = toWebhookEvent(row)
    try {
      const messages = resolveMessages ? await resolveMessages(event, enabledWebhooks) : []
      for (let i = 0; i < messages.length; i += RELAY_SEND_BATCH_SIZE) {
        const chunk = messages.slice(i, i + RELAY_SEND_BATCH_SIZE)
        await queue.sendBatch(chunk.map((body) => ({ body })))
      }
      await outboxRepository.markSent(db, row.eventId)
      relayed++
    } catch (err) {
      const attempt = (row.attempts ?? 0) + 1
      logger.warn('webhook_outbox_relay_failed', {
        eventId: row.eventId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      })
      try {
        if (attempt >= maxAttempts) {
          await outboxRepository.markDead(db, row.eventId)
          dead++
          logger.error('webhook_outbox_row_dead', {
            eventId: row.eventId,
            tenantScope: row.tenantScope,
            attempts: attempt,
          })
        } else {
          await outboxRepository.markFailed(
            db,
            row.eventId,
            new Date(Date.now() + computeOutboxRetryDelayMs(attempt)).toISOString()
          )
        }
      } catch {
        // Best-effort backoff; the lease expires and the row is retried.
      }
    }
  }
  return { relayed, pending: claimed.length - relayed - dead - skipped, dead }
}

/** Prefetch enabled webhooks once per relay/sweep (best-effort). */
export async function loadEnabledWebhooks(db: Database): Promise<unknown[] | undefined> {
  try {
    const chain = db
      .select()
      .from(webhooks)
      .where(eq(webhooks.enabled, true)) as unknown as {
      all?: () => Promise<unknown[]>
    } & PromiseLike<unknown[]>
    return typeof chain.all === 'function' ? await chain.all() : await chain
  } catch {
    // resolveMessages falls back to querying if needed.
    return undefined
  }
}

/**
 * Relay a single command event through the queue (direct send, best-effort).
 * Used by sweeper-style callers that already hold the event. Returns the
 * number of messages sent (0 when skipped or failed).
 */
export async function relayOutboxForCommand(
  db: Database,
  queue?: Queue<WebhookQueueMessage> | null,
  event?: WebhookEvent | null,
  resolveMessages?: ResolveOutboxMessages | null
): Promise<number> {
  if (!queue || !event) return 0
  try {
    const messages = resolveMessages ? await resolveMessages(event) : []
    for (let i = 0; i < messages.length; i += RELAY_SEND_BATCH_SIZE) {
      const chunk = messages.slice(i, i + RELAY_SEND_BATCH_SIZE)
      await queue.sendBatch(chunk.map((body) => ({ body })))
    }
    await outboxRepository.markSent(db, event.id)
    return messages.length
  } catch (err) {
    logger.warn('webhook_outbox_relay_failed', {
      eventId: event.id,
      error: err instanceof Error ? err.message : String(err),
    })
    try {
      await outboxRepository.markFailed(
        db,
        event.id,
        new Date(Date.now() + computeOutboxRetryDelayMs(1)).toISOString()
      )
    } catch {
      // Best-effort backoff.
    }
    return 0
  }
}
