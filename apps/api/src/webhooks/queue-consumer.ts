/**
 * Webhook queue consumer for EdgeCMS.
 *
 * Processes batches of webhook delivery messages from Cloudflare Queues,
 * delivers HTTP POST requests with HMAC signatures, tracks delivery attempts,
 * and implements exponential backoff retry logic.
 */

import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { webhooks, webhookDeliveries } from '@/database/schema/webhooks.schema'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import {
  canDeliver,
  resolveEventTenantScope,
  type WebhookQueueMessage,
} from './queue-producer'
import {
  parseAllowedWebhookHosts,
  validateWebhookDestination,
} from './webhook-destination-policy'
import { calculateBackoffDelay, signPayload } from './webhook-delivery.service'

const QUEUE_MAX_RETRIES = 5
const MIN_WEBHOOK_TIMEOUT_SECONDS = 5
const MAX_WEBHOOK_TIMEOUT_SECONDS = 120
export const WEBHOOK_CONSUMER_CONCURRENCY = 5

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
) {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map((item) => fn(item)))
  }
}

function clampRetryMaxRetries(value: number): number {
  if (!Number.isFinite(value)) return QUEUE_MAX_RETRIES
  return Math.min(QUEUE_MAX_RETRIES, Math.max(1, Math.trunc(value)))
}

function clampWebhookTimeoutSeconds(value: number): number {
  if (!Number.isFinite(value)) return 30
  return Math.min(MAX_WEBHOOK_TIMEOUT_SECONDS, Math.max(MIN_WEBHOOK_TIMEOUT_SECONDS, Math.trunc(value)))
}

/**
 * Deliver a webhook HTTP POST request.
 *
 * Makes an HTTP POST request to the webhook URL with the event payload,
 * HMAC signature, and custom headers. Enforces the configured timeout.
 *
 * @param message - The webhook queue message
 * @returns Promise resolving to { success, status, body }
 */
async function deliverWebhook(message: WebhookQueueMessage): Promise<{
  success: boolean
  status: number
  body: string
}> {
  try {
    const signingHeaders = await signPayload(message.webhookSecret, message.eventPayload)

    if (message.dryRun) {
      return {
        success: true,
        status: 204,
        body: 'Dry-run delivery: signed payload validated without outbound fetch.',
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'EdgeCMS-Webhooks/1.0',
      ...signingHeaders,
      ...message.webhookHeaders,
    }

    // Make HTTP POST request with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), message.timeout * 1000)
    let response: Response
    try {
      response = await fetch(message.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(message.eventPayload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    // Read response body (limit to 10KB to avoid memory issues)
    const bodyText = await response.text()
    const truncatedBody = bodyText.slice(0, 10240)

    return {
      success: response.ok,
      status: response.status,
      body: truncatedBody,
    }
  } catch (error) {
    // Handle fetch errors (network errors, timeouts, etc.)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      status: 0,
      body: `Delivery failed: ${errorMessage}`,
    }
  }
}

/**
 * Cloudflare Queue consumer handler for webhook delivery.
 *
 * Processes batches of webhook delivery messages, attempts delivery,
 * records results in the webhook_deliveries table, and implements
 * retry logic with exponential backoff.
 *
 * @param batch - Batch of messages from Cloudflare Queue
 * @param env - Cloudflare Worker environment bindings
 *
 * @example
 * ```typescript
 * // In worker main.ts:
 * export default {
 *   async queue(batch, env) {
 *     await handleQueue(batch, env)
 *   }
 * }
 * ```
 */
export async function handleQueue(
  batch: MessageBatch<WebhookQueueMessage>,
  env: Env
): Promise<void> {
  const orm = drizzle(env.DB)

  await runWithConcurrency(batch.messages, WEBHOOK_CONSUMER_CONCURRENCY, async (msg) => {
    const message = msg.body

    try {
      // Defense-in-depth: re-validate webhook existence and tenant scope before delivery.
      const rows = await orm
        .select()
        .from(webhooks)
        .where(eq(webhooks.id, message.webhookId))
        .limit(1)
        .all()
      const webhook = rows[0]
      const eventScope = resolveEventTenantScope(message.eventPayload)
      if (eventScope === null) {
        logger.warn('webhook_delivery_malformed_scope_dropped', {
          webhookId: message.webhookId,
          eventId: message.eventPayload.id,
          eventType: message.eventPayload.event,
          messageTenantId: message.tenantId,
        })
        msg.ack()
        return
      }

      if (!webhook || webhook.enabled !== true || !canDeliver(webhook.tenantId, eventScope)) {
        logger.warn('webhook_delivery_scope_mismatch_dropped', {
          webhookId: message.webhookId,
          eventId: message.eventPayload.id,
          eventType: message.eventPayload.event,
          messageTenantId: message.tenantId,
          resolvedEventScope: eventScope,
          webhookTenantId: webhook?.tenantId ?? null,
        })
        msg.ack()
        return
      }

      const destinationValidation = validateWebhookDestination(webhook.url, {
        allowedHosts: parseAllowedWebhookHosts(env.WEBHOOK_ALLOWED_HOSTS),
      })
      if (!destinationValidation.valid) {
        logger.warn('webhook_delivery_invalid_destination_dropped', {
          webhookId: message.webhookId,
          eventId: message.eventPayload.id,
          error: destinationValidation.error,
        })
        msg.ack()
        return
      }

      const effectiveMessage: WebhookQueueMessage = {
        ...message,
        webhookUrl: webhook.url,
        webhookSecret: webhook.secret,
        webhookHeaders: (webhook.headers as Record<string, string> | null | undefined) ?? undefined,
        maxRetries: clampRetryMaxRetries(webhook.retryMaxRetries),
        timeout: clampWebhookTimeoutSeconds(webhook.retryTimeout),
      }

      // Attempt delivery
      const result = await deliverWebhook(effectiveMessage)

      // Calculate current attempt number (0-based to 1-based)
      const currentAttempt = (msg.attempts || 0) + 1

      if (result.success) {
        // Delivery succeeded — record as 'delivered'
        await orm.insert(webhookDeliveries).values({
          id: crypto.randomUUID(),
          webhookId: message.webhookId,
          eventId: message.eventPayload.id,
          eventType: message.eventPayload.event,
          payload: message.eventPayload as unknown as Record<string, unknown>,
          status: 'delivered',
          attempts: currentAttempt,
          lastAttemptAt: new Date().toISOString(),
          nextRetryAt: null,
          responseStatus: result.status,
          responseBody: result.body,
          createdAt: new Date().toISOString(),
        })

        // Acknowledge the message to remove it from the queue
        msg.ack()
      } else {
        // Delivery failed
        if (currentAttempt < effectiveMessage.maxRetries) {
          // Retry with exponential backoff
          const delaySeconds = calculateBackoffDelay(currentAttempt)
          const nextRetryAt = new Date(Date.now() + delaySeconds * 1000).toISOString()

          // Record the failed attempt
          await orm.insert(webhookDeliveries).values({
            id: crypto.randomUUID(),
            webhookId: message.webhookId,
            eventId: message.eventPayload.id,
            eventType: message.eventPayload.event,
            payload: message.eventPayload as unknown as Record<string, unknown>,
            status: 'pending',
            attempts: currentAttempt,
            lastAttemptAt: new Date().toISOString(),
            nextRetryAt,
            responseStatus: result.status,
            responseBody: result.body,
            createdAt: new Date().toISOString(),
          })

          // Retry the message using Cloudflare Queue's native retry mechanism
          msg.retry({ delaySeconds })
        } else {
          // Max retries exhausted — mark as 'failed'
          await orm.insert(webhookDeliveries).values({
            id: crypto.randomUUID(),
            webhookId: message.webhookId,
            eventId: message.eventPayload.id,
            eventType: message.eventPayload.event,
            payload: message.eventPayload as unknown as Record<string, unknown>,
            status: 'failed',
            attempts: currentAttempt,
            lastAttemptAt: new Date().toISOString(),
            nextRetryAt: null,
            responseStatus: result.status,
            responseBody: result.body,
            createdAt: new Date().toISOString(),
          })

          // Acknowledge to prevent infinite retry
          msg.ack()

          logger.error('webhook_delivery_exhausted', {
            webhookId: message.webhookId,
            eventId: message.eventPayload.id,
            attempts: currentAttempt,
            status: result.status,
          })
        }
      }
    } catch (error) {
      // Unexpected error during processing
      logger.error('webhook_queue_processing_failed', {
        error: error instanceof Error ? error.message : String(error),
      })

      // Retry the message to prevent data loss
      msg.retry()
    }
  })
}
