import { type } from 'arktype'
import { id, timestamp } from './common'

/**
 * Webhook schemas for EdgeCMS.
 *
 * Defines validation schemas for webhook registration, event payloads,
 * and delivery tracking.
 */

// ============================================================================
// Event Types
// ============================================================================

/**
 * Webhook event type — identifies which event occurred.
 *
 * Uses dot-notation naming convention: {entity}.{action}
 */
export const webhookEventType = type(
  "'entry.created' | 'entry.updated' | 'entry.deleted' | 'entry.published' | 'entry.unpublished' | 'entry.scheduled' | 'entry.bulk_updated' | 'relation.linked' | 'relation.unlinked' | 'collection.created' | 'collection.updated' | 'collection.deleted'"
)

export type WebhookEventType = typeof webhookEventType.infer

// ============================================================================
// Retry Configuration
// ============================================================================

/**
 * Retry backoff strategy for webhook delivery failures.
 */
export const retryBackoff = type("'exponential' | 'linear'")

export type RetryBackoff = typeof retryBackoff.infer

/**
 * Retry configuration for webhook delivery.
 */
export const retryConfig = type({
  'maxRetries?': '1 <= number.integer <= 10',
  'backoff?': retryBackoff,
  'timeout?': '5 <= number.integer <= 120',
})

export type RetryConfig = typeof retryConfig.infer

// ============================================================================
// Webhook Event Payload
// ============================================================================

/**
 * Webhook event payload structure.
 *
 * This is the JSON payload POSTed to webhook URLs.
 */
export const webhookEventPayload = type({
  id,
  event: webhookEventType,
  timestamp,
  data: type({
    'before?': 'unknown',
    'after?': 'unknown',
    'metadata?': 'unknown',
  }),
})

export type WebhookEventPayload = typeof webhookEventPayload.infer

// ============================================================================
// Webhook Registration
// ============================================================================

/**
 * Payload for creating a new webhook.
 */
export const createWebhookPayload = type({
  url: /^https?:\/\/.+/,
  events: webhookEventType.array(),
  secret: 'string >= 16',
  'headers?': 'Record<string, string>',
  'enabled?': 'boolean',
  'maxRetries?': '1 <= number.integer <= 10',
  'backoff?': retryBackoff,
  'timeout?': '5 <= number.integer <= 120',
})

export type CreateWebhookPayload = typeof createWebhookPayload.infer

/**
 * Payload for updating an existing webhook.
 */
export const updateWebhookPayload = type({
  'url?': /^https?:\/\/.+/,
  'events?': webhookEventType.array(),
  'secret?': 'string >= 16',
  'headers?': 'Record<string, string>',
  'enabled?': 'boolean',
  'maxRetries?': '1 <= number.integer <= 10',
  'backoff?': retryBackoff,
  'timeout?': '5 <= number.integer <= 120',
})

export type UpdateWebhookPayload = typeof updateWebhookPayload.infer

// ============================================================================
// Webhook Delivery Status
// ============================================================================

/**
 * Webhook delivery status discriminant.
 */
export const deliveryStatus = type("'pending' | 'delivered' | 'failed'")

export type DeliveryStatus = typeof deliveryStatus.infer

/**
 * Webhook delivery record.
 */
export const webhookDelivery = type({
  id,
  webhookId: id,
  eventId: id,
  eventType: webhookEventType,
  payload: 'Record<string, unknown>',
  status: deliveryStatus,
  attempts: 'number.integer >= 0',
  'lastAttemptAt?': timestamp,
  'nextRetryAt?': timestamp,
  'responseStatus?': 'number.integer',
  'responseBody?': 'string',
  createdAt: timestamp,
})

export type WebhookDelivery = typeof webhookDelivery.infer
