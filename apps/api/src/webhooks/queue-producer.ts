/**
 * Webhook queue producer for EdgeCMS.
 *
 * Listens to the event bus and enqueues webhook deliveries to Cloudflare Queues
 * for registered webhooks matching the event type.
 */

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { webhooks } from '@/database/schema/webhooks.schema'
import type { Database } from '@/database/db'
import { logger } from '@/observability/logger'
import type { EventType, WebhookEvent } from './event-bus'
import { outboxRepository } from './outbox.repository'

/**
 * Queue message format for webhook delivery.
 *
 * Contains all information needed to deliver the webhook, including
 * the webhook configuration and the event payload.
 */
export interface WebhookQueueMessage {
  /** Webhook ID from the webhooks table. */
  webhookId: string
  /** Full webhook event payload (id, event, timestamp, data). */
  eventPayload: WebhookEvent
  /** HTTP(S) URL to POST the event to. */
  webhookUrl: string
  /** HMAC secret for signing the payload. */
  webhookSecret: string
  /** Custom HTTP headers to include in the request. */
  webhookHeaders?: Record<string, string>
  /** Maximum number of retry attempts. */
  maxRetries: number
  /** Timeout in seconds for the HTTP request. */
  timeout: number
  /** Tenant scope for this webhook event. Always explicit: 'global' or tenant ID. */
  tenantId: string | 'global'
  /** Validate/sign the message and record a delivery without performing outbound fetch. */
  dryRun?: boolean
}

const SUBSCRIPTION_CACHE_TTL_MS = 30_000
const QUEUE_MAX_RETRIES = 5
const QUEUE_SEND_BATCH_SIZE = 100
let invalidateSubscriptionCacheRef: (() => void) | undefined

/**
 * Resolve event delivery scope from event metadata.
 *
 * Contract:
 * - Tenant command events must include metadata.syncChannel tenant id.
 * - Global events resolve to 'global'.
 * - Missing/invalid syncChannel is treated as malformed and returns null.
 */
export function resolveEventTenantScope(event: WebhookEvent): string | 'global' | null {
  const metadata = event.data.metadata as { syncChannel?: string } | undefined
  const syncChannel = metadata?.syncChannel?.trim()
  if (!syncChannel) {
    return null
  }
  if (syncChannel === 'global') {
    return 'global'
  }
  return syncChannel
}

/**
 * Delivery policy single source of truth:
 * - global events -> only global webhooks
 * - tenant events -> only matching tenant webhooks
 */
export function canDeliver(
  webhookTenantId: string | null | undefined,
  eventScope: string | 'global'
): boolean {
  const normalizedWebhookTenant = webhookTenantId?.trim() || 'global'
  return normalizedWebhookTenant === eventScope
}

function normalizeQueueMaxRetries(value: number): number {
  if (!Number.isFinite(value)) return QUEUE_MAX_RETRIES
  return Math.min(QUEUE_MAX_RETRIES, Math.max(1, Math.trunc(value)))
}

export function invalidateWebhookSubscriptionCache(): void {
  invalidateSubscriptionCacheRef?.()
}

type WebhookRow = typeof webhooks.$inferSelect

/**
 * Map subscription rows to queue messages for an event.
 *
 * Single source of truth for tenant-scope filtering + message shaping.
 * Returns null when the event scope is malformed (missing syncChannel).
 */
export function toQueueMessages(
  subscriptionRows: WebhookRow[],
  event: WebhookEvent
): WebhookQueueMessage[] | null {
  const eventScope = resolveEventTenantScope(event)
  if (eventScope === null) {
    return null
  }
  const deliverableWebhooks = subscriptionRows.filter((webhook) =>
    canDeliver(webhook.tenantId, eventScope)
  )
  return deliverableWebhooks.map((webhook) => ({
    webhookId: webhook.id,
    eventPayload: event,
    webhookUrl: webhook.url,
    webhookSecret: webhook.secret,
    webhookHeaders: webhook.headers as Record<string, string> | undefined,
    maxRetries: normalizeQueueMaxRetries(webhook.retryMaxRetries),
    timeout: webhook.retryTimeout,
    tenantId: eventScope,
  }))
}

/**
 * Resolve queue messages for an event with a fresh subscription query
 * (no cache). Used by the outbox relay sweeper; the live listener path
 * below keeps its cached subscriptions.
 */
export async function buildMessagesForEvent(
  db: Database,
  event: WebhookEvent,
  cachedWebhooks?: WebhookRow[]
): Promise<WebhookQueueMessage[]> {
  try {
    let enabledWebhooks = cachedWebhooks
    if (!enabledWebhooks) {
      const chain = db
        .select()
        .from(webhooks)
        .where(eq(webhooks.enabled, true)) as unknown as {
        all?: () => Promise<WebhookRow[]>
      } & PromiseLike<WebhookRow[]>
      enabledWebhooks =
        typeof chain.all === 'function' ? await chain.all() : await chain
    }
    const matching = enabledWebhooks.filter((webhook) =>
      (webhook.events as EventType[]).includes(event.event)
    )
    const messages = toQueueMessages(matching, event)
    if (messages === null) {
      logger.warn('webhook_enqueue_malformed_scope_dropped', {
        eventId: event.id,
        eventType: event.event,
      })
      return []
    }
    return messages
  } catch (error) {
    logger.error('webhook_enqueue_failed', {
      eventType: event.event,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

/**
 * Initialize the webhook queue producer.
 *
 * Registers event listeners on the event bus that query for matching webhooks
 * and enqueue delivery messages to the Cloudflare Queue.
 *
 * @param eventBus - The global event bus instance (must have on/off/emit methods)
 * @param db - D1 database binding
 * @param queue - Cloudflare Queue binding (WEBHOOK_QUEUE)
 *
 * @example
 * ```typescript
 * import { eventBus } from '@/webhooks/event-bus'
 * import { initWebhookProducer } from '@/webhooks/queue-producer'
 *
 * // In worker startup:
 * initWebhookProducer(eventBus, env.DB, env.WEBHOOK_QUEUE)
 * ```
 */
export function initWebhookProducer(
  eventBus: {
    on(eventType: EventType, callback: (event: WebhookEvent) => void | Promise<void>): void
  },
  db: D1Database,
  queue: Queue<WebhookQueueMessage>
): void {
  const orm = drizzle(db)
  let subscriptionsPromise: Promise<Map<EventType, WebhookRow[]>> | null = null
  let subscriptionsExpiresAt = 0

  const clearSubscriptionCache = () => {
    subscriptionsPromise = null
    subscriptionsExpiresAt = 0
  }
  invalidateSubscriptionCacheRef = clearSubscriptionCache

  async function getSubscriptions(): Promise<Map<EventType, WebhookRow[]>> {
    if (!subscriptionsPromise || Date.now() >= subscriptionsExpiresAt) {
      subscriptionsPromise = (async () => {
        const enabledWebhooks = await orm
          .select()
          .from(webhooks)
          .where(eq(webhooks.enabled, true))
          .all()

        const byEvent = new Map<EventType, WebhookRow[]>()
        for (const webhook of enabledWebhooks) {
          const events = webhook.events as EventType[]
          for (const event of events) {
            const list = byEvent.get(event) ?? []
            list.push(webhook)
            byEvent.set(event, list)
          }
        }
        return byEvent
      })()
      subscriptionsExpiresAt = Date.now() + SUBSCRIPTION_CACHE_TTL_MS
    }
    return subscriptionsPromise
  }

  // Register a single listener that handles all event types
  const eventTypes: EventType[] = [
    'entry.created',
    'entry.updated',
    'entry.deleted',
    'entry.published',
    'entry.unpublished',
    'entry.scheduled',
    'entry.bulk_updated',
    'relation.linked',
    'relation.unlinked',
    'collection.created',
    'collection.updated',
    'collection.deleted',
    'tenant.created',
    'tenant.activated',
    'tenant.suspended',
    'tenant.deleted',
    'tenant.limit_reached',
  ]

  for (const eventType of eventTypes) {
    eventBus.on(eventType, async (event: WebhookEvent) => {
      try {
        const subscriptions = await getSubscriptions()
        const matchingWebhooks = subscriptions.get(event.event) ?? []
        const messages = toQueueMessages(matchingWebhooks, event)
        if (messages === null) {
          logger.warn('webhook_enqueue_malformed_scope_dropped', {
            eventId: event.id,
            eventType: event.event,
          })
          return
        }

        for (let i = 0; i < messages.length; i += QUEUE_SEND_BATCH_SIZE) {
          const chunk = messages.slice(i, i + QUEUE_SEND_BATCH_SIZE)
          await queue.sendBatch(chunk.map((body) => ({ body })))
        }

        // Close the outbox loop: the engine wrote a pending row atomically
        // with the command commit (linked via metadata.outboxEventId).
        // Best-effort — a failure here leaves the row pending for the relay.
        const outboxEventId = (event.data.metadata as { outboxEventId?: unknown } | undefined)
          ?.outboxEventId
        if (typeof outboxEventId === 'string' && outboxEventId.length > 0) {
          try {
            await outboxRepository.markSent(orm, outboxEventId)
          } catch {
            // Sweeper replays still-pending rows.
          }
        }
      } catch (error) {
        // Log error but don't throw — we don't want webhook delivery failures
        // to break the main event flow
        logger.error('webhook_enqueue_failed', {
          eventType: event.event,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  }
}
