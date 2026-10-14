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
 * - a sweeper cron / admin relay endpoint (follow-up, not yet wired) calls
 *   relayOutbox() without staleOnlyMs to drain all due rows.
 *
 * Subscription resolution is injected via callback to avoid circular imports:
 * the producer passes (event) => buildMessagesForEvent(db, event).
 */

export type ResolveOutboxMessages = (event: WebhookEvent) => Promise<WebhookQueueMessage[]>

const RELAY_SEND_BATCH_SIZE = 100
const RELAY_RETRY_DELAY_MS = 60_000

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
 * success; on sendBatch failure leaves the row pending with +60s backoff.
 * Never throws — per-row failures are contained.
 */
export async function relayOutbox(
  db: Database,
  queue?: Queue<WebhookQueueMessage> | null,
  resolveMessages?: ResolveOutboxMessages | null,
  opts?: { limit?: number; staleOnlyMs?: number }
): Promise<{ relayed: number; pending: number }> {
  if (!queue) return { relayed: 0, pending: 0 }
  let claimed: OutboxRow[]
  try {
    claimed = await outboxRepository.claimPending(db, opts?.limit ?? 20, {
      staleOnlyMs: opts?.staleOnlyMs,
    })
  } catch (err) {
    logger.warn('webhook_outbox_claim_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return { relayed: 0, pending: 0 }
  }
  if (claimed.length === 0) return { relayed: 0, pending: 0 }

  let relayed = 0
  for (const row of claimed) {
    const event = toWebhookEvent(row)
    try {
      const messages = resolveMessages ? await resolveMessages(event) : []
      for (let i = 0; i < messages.length; i += RELAY_SEND_BATCH_SIZE) {
        const chunk = messages.slice(i, i + RELAY_SEND_BATCH_SIZE)
        await queue.sendBatch(chunk.map((body) => ({ body })))
      }
      await outboxRepository.markSent(db, row.eventId)
      relayed++
    } catch (err) {
      logger.warn('webhook_outbox_relay_failed', {
        eventId: row.eventId,
        error: err instanceof Error ? err.message : String(err),
      })
      try {
        await outboxRepository.markFailed(
          db,
          row.eventId,
          new Date(Date.now() + RELAY_RETRY_DELAY_MS).toISOString()
        )
      } catch {
        // Best-effort backoff; row stays pending for the next sweep.
      }
    }
  }
  return { relayed, pending: claimed.length - relayed }
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
        new Date(Date.now() + RELAY_RETRY_DELAY_MS).toISOString()
      )
    } catch {
      // Best-effort backoff.
    }
    return 0
  }
}
