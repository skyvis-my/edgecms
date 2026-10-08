import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Webhooks table — stores webhook endpoint registrations.
 *
 * Each webhook defines a URL endpoint, the events it subscribes to,
 * authentication secrets, and retry behavior for delivery failures.
 */
export const webhooks = sqliteTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('global'),
    /** HTTP(S) URL to POST events to. */
    url: text('url').notNull(),
    /** JSON-serialised array of event type strings (e.g., ["entry.created", "entry.updated"]). */
    events: text('events', { mode: 'json' }).notNull().$type<string[]>(),
    /** HMAC secret for signing webhook payloads (webhooks can verify authenticity). */
    secret: text('secret').notNull(),
    /** JSON-serialised object of custom HTTP headers to include in requests. */
    headers: text('headers', { mode: 'json' }).$type<Record<string, string>>(),
    /** Whether this webhook is active (0 = disabled, 1 = enabled). */
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /** Maximum number of retry attempts for failed deliveries. */
    retryMaxRetries: integer('retry_max_retries').notNull().default(5),
    /** Retry backoff strategy: 'exponential' or 'linear'. */
    retryBackoff: text('retry_backoff').notNull().default('exponential'),
    /** Timeout in seconds for webhook HTTP requests. */
    retryTimeout: integer('retry_timeout').notNull().default(30),
    /** ISO 8601 timestamp. */
    createdAt: text('created_at').notNull(),
    /** ISO 8601 timestamp. */
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    // Index for querying enabled webhooks by event type
    index('webhooks_enabled_idx').on(table.enabled),
    index('webhooks_tenant_id_idx').on(table.tenantId),
    // Composite index helps active-subscription scans.
    index('webhooks_tenant_enabled_events_idx').on(table.tenantId, table.enabled, table.events),
  ]
)

/**
 * Webhook deliveries table — tracks delivery attempts and status.
 *
 * Each row represents one delivery attempt for a webhook event.
 * The status column tracks whether the delivery succeeded, failed, or is pending.
 * Failed deliveries can be retried based on the webhook's retry configuration.
 */
export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    /** Foreign key to webhooks.id — which webhook this delivery is for. */
    webhookId: text('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    /** The unique event ID that triggered this delivery. */
    eventId: text('event_id').notNull(),
    /** The event type (e.g., "entry.created"). */
    eventType: text('event_type').notNull(),
    /** JSON-serialised webhook event payload (includes before/after/metadata). */
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    /** Delivery status: pending, delivered, or failed. */
    status: text('status').notNull().default('pending'),
    /** Number of delivery attempts made so far. */
    attempts: integer('attempts').notNull().default(0),
    /** ISO 8601 timestamp of the most recent delivery attempt (nullable for new deliveries). */
    lastAttemptAt: text('last_attempt_at'),
    /** ISO 8601 timestamp of when the next retry should occur (nullable if no retry scheduled). */
    nextRetryAt: text('next_retry_at'),
    /** HTTP status code from the last delivery attempt (nullable if not yet attempted). */
    responseStatus: integer('response_status'),
    /** Response body from the last delivery attempt (nullable if not yet attempted). */
    responseBody: text('response_body'),
    /** ISO 8601 timestamp. */
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    // Index for querying deliveries by webhook
    index('webhook_deliveries_webhook_id_idx').on(table.webhookId),
    // Index for querying deliveries by status (to find pending/failed deliveries)
    index('webhook_deliveries_status_idx').on(table.status),
    // Index for querying deliveries by event ID
    index('webhook_deliveries_event_id_idx').on(table.eventId),
    // Index for querying deliveries due for retry
    index('webhook_deliveries_next_retry_at_idx').on(table.nextRetryAt),
  ]
)
