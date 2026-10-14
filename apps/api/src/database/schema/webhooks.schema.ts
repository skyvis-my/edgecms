import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    index('webhooks_tenant_enabled_idx').on(table.tenantId, table.enabled),
    index('webhooks_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('webhooks_enabled_idx').on(table.enabled),
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
    // Composite index for querying and paginating deliveries by webhook
    index('webhook_deliveries_webhook_created_idx').on(table.webhookId, table.createdAt),
    // Composite index for retry polling (status + next retry time)
    index('webhook_deliveries_status_retry_idx').on(table.status, table.nextRetryAt),
    // Index for querying deliveries by event ID
    index('webhook_deliveries_event_id_idx').on(table.eventId),
    // Dedup guard: one delivery row per (event, webhook) — absorbs queue
    // at-least-once redelivery without inflating retry accounting.
    uniqueIndex('webhook_deliveries_event_webhook_unique').on(table.eventId, table.webhookId),
  ]
)

/**
 * Webhook outbox table — transactional intent log for webhook events.
 *
 * H1 durability: command engine writes one row here in the SAME db.batch()
 * as the processed command + audit rows, so a crash between DB commit and
 * queue.sendBatch never loses the webhook — a sweeper (see outbox-relay.ts)
 * replays still-pending rows. eventId is UNIQUE so double-enqueue is a no-op.
 */
export const webhookOutbox = sqliteTable(
  'webhook_outbox',
  {
    id: text('id').primaryKey(),
    /** Unique event ID — doubles as idempotency key for enqueue. */
    eventId: text('event_id').notNull().unique(),
    /** Dot-notation event type (e.g., "entry.created"). */
    eventType: text('event_type').notNull(),
    /** JSON-serialised WebhookEvent data: { event, metadata, after, before }. */
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    /** Tenant scope: 'global' or tenant ID. */
    tenantScope: text('tenant_scope').notNull().default('global'),
    /** Command that produced the event (nullable for non-command events). */
    commandId: text('command_id'),
    /** Outbox status: pending, sent, or failed. */
    status: text('status').notNull().default('pending'),
    /** Number of relay attempts made so far. */
    attempts: integer('attempts').notNull().default(0),
    /** ISO 8601 timestamp of when the next relay attempt should occur. */
    nextAttemptAt: text('next_attempt_at'),
    /** ISO 8601 timestamp. */
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('webhook_outbox_event_id_unique').on(table.eventId),
    index('webhook_outbox_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
  ]
)
