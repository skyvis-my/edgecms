import { Type, createSchema } from './typebox'
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
export const webhookEventType = createSchema(
  Type.Union([
    Type.Literal('entry.created'),
    Type.Literal('entry.updated'),
    Type.Literal('entry.deleted'),
    Type.Literal('entry.published'),
    Type.Literal('entry.unpublished'),
    Type.Literal('entry.scheduled'),
    Type.Literal('entry.bulk_updated'),
    Type.Literal('relation.linked'),
    Type.Literal('relation.unlinked'),
    Type.Literal('collection.created'),
    Type.Literal('collection.updated'),
    Type.Literal('collection.deleted'),
  ])
)

export type WebhookEventType = typeof webhookEventType.infer

// ============================================================================
// Retry Configuration
// ============================================================================

/**
 * Retry backoff strategy for webhook delivery failures.
 */
export const retryBackoff = createSchema(
  Type.Union([
    Type.Literal('exponential'),
    Type.Literal('linear'),
  ])
)

export type RetryBackoff = typeof retryBackoff.infer

/**
 * Retry configuration for webhook delivery.
 */
export const retryConfig = createSchema(
  Type.Object({
    maxRetries: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    backoff: Type.Optional(retryBackoff),
    timeout: Type.Optional(Type.Integer({ minimum: 5, maximum: 120 })),
  })
)

export type RetryConfig = typeof retryConfig.infer

// ============================================================================
// Webhook Event Payload
// ============================================================================

/**
 * Webhook event payload structure.
 *
 * This is the JSON payload POSTed to webhook URLs.
 */
export const webhookEventPayload = createSchema(
  Type.Object({
    id,
    event: webhookEventType,
    timestamp,
    data: Type.Object({
      before: Type.Optional(Type.Unknown()),
      after: Type.Optional(Type.Unknown()),
      metadata: Type.Optional(Type.Unknown()),
    }),
  })
)

export type WebhookEventPayload = typeof webhookEventPayload.infer

// ============================================================================
// Webhook Registration
// ============================================================================

/**
 * Payload for creating a new webhook.
 */
export const createWebhookPayload = createSchema(
  Type.Object({
    url: Type.RegExp(/^https?:\/\/.+/),
    events: Type.Array(webhookEventType),
    secret: Type.String({ minLength: 16 }),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    enabled: Type.Optional(Type.Boolean()),
    maxRetries: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    backoff: Type.Optional(retryBackoff),
    timeout: Type.Optional(Type.Integer({ minimum: 5, maximum: 120 })),
  })
)

export type CreateWebhookPayload = typeof createWebhookPayload.infer

/**
 * Payload for updating an existing webhook.
 */
export const updateWebhookPayload = createSchema(
  Type.Object({
    url: Type.Optional(Type.RegExp(/^https?:\/\/.+/)),
    events: Type.Optional(Type.Array(webhookEventType)),
    secret: Type.Optional(Type.String({ minLength: 16 })),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    enabled: Type.Optional(Type.Boolean()),
    maxRetries: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    backoff: Type.Optional(retryBackoff),
    timeout: Type.Optional(Type.Integer({ minimum: 5, maximum: 120 })),
  })
)

export type UpdateWebhookPayload = typeof updateWebhookPayload.infer

// ============================================================================
// Webhook Delivery Status
// ============================================================================

/**
 * Webhook delivery status discriminant.
 */
export const deliveryStatus = createSchema(
  Type.Union([
    Type.Literal('pending'),
    Type.Literal('delivered'),
    Type.Literal('failed'),
  ])
)

export type DeliveryStatus = typeof deliveryStatus.infer

/**
 * Webhook delivery record.
 */
export const webhookDelivery = createSchema(
  Type.Object({
    id,
    webhookId: id,
    eventId: id,
    eventType: webhookEventType,
    payload: Type.Record(Type.String(), Type.Unknown()),
    status: deliveryStatus,
    attempts: Type.Integer({ minimum: 0 }),
    lastAttemptAt: Type.Optional(timestamp),
    nextRetryAt: Type.Optional(timestamp),
    responseStatus: Type.Optional(Type.Integer()),
    responseBody: Type.Optional(Type.String()),
    createdAt: timestamp,
  })
)

export type WebhookDelivery = typeof webhookDelivery.infer
