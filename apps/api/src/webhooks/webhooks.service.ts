import type { Database } from '@/database/db'
import type { ServiceResult } from '@/shared/types/result'
import type { WebhookEvent } from './event-bus'
import {
  canDeliver,
  invalidateWebhookSubscriptionCache,
  resolveEventTenantScope,
  type WebhookQueueMessage,
} from './queue-producer'
import { buildWebhookRequestHeaders, signTimestampedPayload } from './webhook-delivery.service'
import {
  type WebhookDestinationPolicy,
  validateWebhookDestination,
} from './webhook-destination-policy'
import { type WebhookRow, webhooksRepository } from './webhooks.repository'
import {
  MAX_BULK_REPLAY,
  REPLAYABLE_DELIVERY_STATUSES,
  type ReplayableDeliveryStatus,
} from './webhook-replay-policy'

export { MAX_BULK_REPLAY, REPLAYABLE_DELIVERY_STATUSES, type ReplayableDeliveryStatus }

/** Input for creating a webhook. */
export interface CreateWebhookInput {
  url: string
  events: string[]
  headers?: Record<string, string>
  enabled?: boolean
  retryMaxRetries?: number
  retryBackoff?: 'exponential' | 'linear'
  retryTimeout?: number
}

/** Input for updating a webhook. */
export interface UpdateWebhookInput {
  url?: string
  events?: string[]
  headers?: Record<string, string>
  enabled?: boolean
  retryMaxRetries?: number
  retryBackoff?: 'exponential' | 'linear'
  retryTimeout?: number
}

/** Test delivery response. */
export interface TestDeliveryResult {
  status: number
  body: string
  success: boolean
}

const MAX_STORED_RESPONSE_BODY_BYTES = 10_240
const MAX_QUEUE_RETRIES = 5

/** Bulk replay response. */
export interface BulkReplayResult {
  replayed: number
  skipped: number
  deliveryIds: string[]
}

function normalizeRetryMaxRetries(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return MAX_QUEUE_RETRIES
  }
  return Math.min(MAX_QUEUE_RETRIES, Math.max(1, Math.trunc(value)))
}

/**
 * Generate a cryptographically secure random hex string.
 * Used for webhook signing secrets.
 */
function generateSecret(length = 32): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Validate webhook URL.
 * Must be HTTPS for security.
 */
function validateUrl(
  url: string,
  policy?: WebhookDestinationPolicy
): { valid: true } | { valid: false; error: string } {
  return validateWebhookDestination(url, policy)
}

/**
 * Validate webhook events array.
 * Must contain at least one valid event type.
 */
const VALID_EVENT_TYPES = [
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
]

/**
 * Tenant lifecycle events (HS-08) are delivered with global scope and describe
 * every tenant, so only super-admins may subscribe to them, on global webhooks.
 */
const GLOBAL_ONLY_EVENT_TYPES = [
  'tenant.created',
  'tenant.activated',
  'tenant.suspended',
  'tenant.deleted',
  'tenant.limit_reached',
]

/** Caller capabilities that widen what a webhook may subscribe to. */
export interface WebhookSubscriptionOptions {
  /** Super-admin caller: may subscribe a global webhook to tenant.* events. */
  allowTenantLifecycleEvents?: boolean
}

function validateEvents(
  events: string[],
  tenantId: string | undefined,
  options: WebhookSubscriptionOptions
): { valid: true } | { valid: false; error: string } {
  if (!events || events.length === 0) {
    return { valid: false, error: 'Events array must contain at least one event type' }
  }

  const validTypes =
    !tenantId && options.allowTenantLifecycleEvents
      ? [...VALID_EVENT_TYPES, ...GLOBAL_ONLY_EVENT_TYPES]
      : VALID_EVENT_TYPES
  const invalidEvents = events.filter((e) => !validTypes.includes(e))
  if (invalidEvents.length > 0) {
    return {
      valid: false,
      error: `Invalid event types: ${invalidEvents.join(', ')}. Valid types: ${validTypes.join(', ')}`,
    }
  }

  return { valid: true }
}

/**
 * Business logic layer for webhooks.
 *
 * Orchestrates repository calls with validation, secret generation,
 * and error handling.
 */
export const webhooksService = {
  /** List all webhooks. */
  async findAll(db: Database, tenantId?: string): Promise<ServiceResult<WebhookRow[]>> {
    const data = tenantId
      ? await webhooksRepository.findAll(db, tenantId)
      : await webhooksRepository.findAll(db)
    return { success: true, data }
  },

  /** Get a webhook by ID. */
  async findById(db: Database, id: string, tenantId?: string): Promise<ServiceResult<WebhookRow>> {
    const webhook = tenantId
      ? await webhooksRepository.findById(db, id, tenantId)
      : await webhooksRepository.findById(db, id)
    if (!webhook) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Webhook '${id}' not found` },
      }
    }
    return { success: true, data: webhook }
  },

  /** Create a new webhook with auto-generated ID and secret. */
  async create(
    db: Database,
    input: CreateWebhookInput,
    tenantId?: string,
    policy?: WebhookDestinationPolicy,
    options: WebhookSubscriptionOptions = {}
  ): Promise<ServiceResult<WebhookRow>> {
    // Validate URL
    const urlValidation = validateUrl(input.url, policy)
    if (!urlValidation.valid) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: urlValidation.error },
      }
    }

    // Validate events
    const eventsValidation = validateEvents(input.events, tenantId, options)
    if (!eventsValidation.valid) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: eventsValidation.error },
      }
    }

    // Generate ID and secret
    const id = crypto.randomUUID()
    const secret = generateSecret(32)
    const now = new Date().toISOString()

    const row = await webhooksRepository.create(db, {
      id,
      tenantId: tenantId ?? 'global',
      url: input.url,
      events: input.events,
      secret,
      headers: input.headers ?? null,
      enabled: input.enabled ?? true,
      retryMaxRetries: normalizeRetryMaxRetries(input.retryMaxRetries),
      retryBackoff: input.retryBackoff ?? 'exponential',
      retryTimeout: input.retryTimeout ?? 30,
      createdAt: now,
      updatedAt: now,
    })

    invalidateWebhookSubscriptionCache()
    return { success: true, data: row }
  },

  /** Update an existing webhook by ID. */
  async update(
    db: Database,
    id: string,
    input: UpdateWebhookInput,
    tenantId?: string,
    policy?: WebhookDestinationPolicy,
    options: WebhookSubscriptionOptions = {}
  ): Promise<ServiceResult<WebhookRow>> {
    const existing = tenantId
      ? await webhooksRepository.findById(db, id, tenantId)
      : await webhooksRepository.findById(db, id)
    if (!existing) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Webhook '${id}' not found` },
      }
    }

    // Validate URL if being updated
    if (input.url) {
      const urlValidation = validateUrl(input.url, policy)
      if (!urlValidation.valid) {
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: urlValidation.error },
        }
      }
    }

    // Validate events if being updated
    if (input.events) {
      const eventsValidation = validateEvents(input.events, tenantId, options)
      if (!eventsValidation.valid) {
        return {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: eventsValidation.error },
        }
      }
    }

    const now = new Date().toISOString()
    const updateInput: UpdateWebhookInput = { ...input }
    if (updateInput.retryMaxRetries !== undefined) {
      updateInput.retryMaxRetries = normalizeRetryMaxRetries(updateInput.retryMaxRetries)
    }

    const updated = tenantId
      ? await webhooksRepository.update(
          db,
          id,
          {
            ...updateInput,
            updatedAt: now,
          },
          tenantId
        )
      : await webhooksRepository.update(db, id, {
          ...updateInput,
          updatedAt: now,
        })

    if (!updated) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Webhook '${id}' not found` },
      }
    }

    invalidateWebhookSubscriptionCache()
    return { success: true, data: updated }
  },

  /** Delete a webhook by ID. */
  async deleteById(
    db: Database,
    id: string,
    tenantId?: string
  ): Promise<ServiceResult<{ id: string }>> {
    const deleted = tenantId
      ? await webhooksRepository.deleteById(db, id, tenantId)
      : await webhooksRepository.deleteById(db, id)
    if (!deleted) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Webhook '${id}' not found` },
      }
    }
    invalidateWebhookSubscriptionCache()
    return { success: true, data: { id } }
  },

  /** Send a test delivery to the webhook URL. */
  async testDelivery(
    db: Database,
    webhookId: string,
    tenantId?: string,
    policy: WebhookDestinationPolicy = {}
  ): Promise<ServiceResult<TestDeliveryResult>> {
    const webhook = tenantId
      ? await webhooksRepository.findById(db, webhookId, tenantId)
      : await webhooksRepository.findById(db, webhookId)
    if (!webhook) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Webhook '${webhookId}' not found` },
      }
    }

    // SSRF guard: the stored URL was validated at write time, but the policy
    // (blocked ranges, WEBHOOK_ALLOWED_HOSTS) may have tightened since.
    const destination = validateWebhookDestination(webhook.url, policy)
    if (!destination.valid) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: destination.error },
      }
    }

    // Create test payload
    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { test: true },
    }

    // Send POST request to webhook URL
    try {
      const { headers: signingHeaders } = await signTimestampedPayload(
        webhook.secret,
        testPayload
      )
      const headers = buildWebhookRequestHeaders(
        webhook.headers as Record<string, string> | null,
        { 'Content-Type': 'application/json', 'User-Agent': 'EdgeCMS-Webhook/1.0' },
        signingHeaders
      )

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(webhook.retryTimeout * 1000),
        // SSRF guard: never follow a redirect to an unvalidated host.
        redirect: 'manual',
      })

      const body = (await response.text()).slice(0, MAX_STORED_RESPONSE_BODY_BYTES)

      // Record test delivery
      const now = new Date().toISOString()
      await webhooksRepository.createDelivery(db, {
        id: crypto.randomUUID(),
        webhookId: webhook.id,
        eventId: crypto.randomUUID(),
        eventType: 'test',
        payload: testPayload,
        status: response.ok ? 'delivered' : 'failed',
        attempts: 1,
        lastAttemptAt: now,
        nextRetryAt: null,
        responseStatus: response.status,
        responseBody: body,
        createdAt: now,
      })

      return {
        success: true,
        data: {
          status: response.status,
          body,
          success: response.ok,
        },
      }
    } catch (error) {
      const errorMessage = (error instanceof Error ? error.message : 'Unknown error').slice(
        0,
        MAX_STORED_RESPONSE_BODY_BYTES
      )

      // Record failed test delivery
      const now = new Date().toISOString()
      await webhooksRepository.createDelivery(db, {
        id: crypto.randomUUID(),
        webhookId: webhook.id,
        eventId: crypto.randomUUID(),
        eventType: 'test',
        payload: testPayload,
        status: 'failed',
        attempts: 1,
        lastAttemptAt: now,
        nextRetryAt: null,
        responseStatus: null,
        responseBody: errorMessage,
        createdAt: now,
      })

      return {
        success: false,
        error: {
          code: 'DELIVERY_FAILED',
          message: `Failed to deliver test webhook: ${errorMessage}`,
        },
      }
    }
  },

  /** Get delivery logs for a webhook with pagination. */
  async getDeliveries(
    db: Database,
    webhookId: string,
    tenantId?: string,
    options?: { limit?: number; offset?: number }
  ): Promise<ServiceResult<{ deliveries: unknown[]; total: number }>> {
    const webhook = tenantId
      ? await webhooksRepository.findById(db, webhookId, tenantId)
      : await webhooksRepository.findById(db, webhookId)
    if (!webhook) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Webhook '${webhookId}' not found` },
      }
    }

    const deliveries = await webhooksRepository.findDeliveries(db, webhookId, options)

    return {
      success: true,
      data: {
        deliveries,
        total: deliveries.length,
      },
    }
  },

  /**
   * Replay a failed delivery (DL-09): re-enqueue the stored event for the
   * webhook's current URL and secret. The queue consumer re-validates scope
   * and destination and dedups on (eventId, webhookId), so only deliveries
   * that never succeeded are replayable ('failed' or 'dead').
   */
  async replayDelivery(
    db: Database,
    queue: Pick<Queue<WebhookQueueMessage>, 'send'> | null | undefined,
    webhookId: string,
    deliveryId: string,
    tenantId?: string
  ): Promise<ServiceResult<{ deliveryId: string; eventId: string; status: 'pending' }>> {
    const webhook = tenantId
      ? await webhooksRepository.findById(db, webhookId, tenantId)
      : await webhooksRepository.findById(db, webhookId)
    if (!webhook) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Webhook '${webhookId}' not found` },
      }
    }

    const delivery = await webhooksRepository.findDeliveryById(db, deliveryId, webhookId)
    if (!delivery) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Delivery '${deliveryId}' not found` },
      }
    }
    if (delivery.eventType === 'test') {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Test deliveries cannot be replayed' },
      }
    }
    if (!(REPLAYABLE_DELIVERY_STATUSES as readonly string[]).includes(delivery.status)) {
      return {
        success: false,
        error: {
          code: 'CONFLICT',
          message: `Only failed or dead deliveries can be replayed (status is '${delivery.status}')`,
        },
      }
    }

    const event = delivery.payload as unknown as WebhookEvent
    const eventScope =
      event && typeof event === 'object' && event.data ? resolveEventTenantScope(event) : null
    if (eventScope === null || !canDeliver(webhook.tenantId, eventScope)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Stored delivery payload has no deliverable tenant scope',
        },
      }
    }

    if (!queue) {
      return {
        success: false,
        error: { code: 'QUEUE_UNAVAILABLE', message: 'WEBHOOK_QUEUE binding is not configured' },
      }
    }

    await queue.send({
      webhookId: webhook.id,
      eventPayload: event,
      webhookUrl: webhook.url,
      webhookSecret: webhook.secret,
      webhookHeaders: (webhook.headers as Record<string, string> | null) ?? undefined,
      maxRetries: normalizeRetryMaxRetries(webhook.retryMaxRetries),
      timeout: webhook.retryTimeout,
      tenantId: eventScope,
    })
    await webhooksRepository.updateDelivery(
      db,
      delivery.id,
      { status: 'pending', nextRetryAt: new Date().toISOString() },
      webhookId
    )

    return {
      success: true,
      data: { deliveryId: delivery.id, eventId: delivery.eventId, status: 'pending' },
    }
  },
  /**
   * Bulk replay (DL-09): re-enqueue up to MAX_BULK_REPLAY dead/failed
   * deliveries of one webhook, oldest first. Rows are first moved to
   * 'pending' with a conditional update, and only the rows this call moved
   * are sent, so overlapping replays never enqueue the same delivery twice.
   * Stored payloads whose scope no longer matches the webhook's tenant are
   * skipped. On a queue failure the claimed rows return to their status.
   */
  async replayDeliveries(
    db: Database,
    queue: Pick<Queue<WebhookQueueMessage>, 'sendBatch'> | null | undefined,
    webhookId: string,
    tenantId?: string,
    options: { statuses?: ReplayableDeliveryStatus[]; limit?: number } = {}
  ): Promise<ServiceResult<BulkReplayResult>> {
    const webhook = tenantId
      ? await webhooksRepository.findById(db, webhookId, tenantId)
      : await webhooksRepository.findById(db, webhookId)
    if (!webhook) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: `Webhook '${webhookId}' not found` },
      }
    }
    if (!queue) {
      return {
        success: false,
        error: { code: 'QUEUE_UNAVAILABLE', message: 'WEBHOOK_QUEUE binding is not configured' },
      }
    }

    const statuses = (options.statuses?.length ? options.statuses : REPLAYABLE_DELIVERY_STATUSES)
      .filter((status) => (REPLAYABLE_DELIVERY_STATUSES as readonly string[]).includes(status))
    const requested = Number.isFinite(options.limit) ? Math.trunc(options.limit as number) : MAX_BULK_REPLAY
    const limit = Math.min(MAX_BULK_REPLAY, Math.max(1, requested))

    const candidates = await webhooksRepository.findReplayableDeliveries(
      db,
      webhook.id,
      [...statuses],
      limit
    )
    let skipped = 0
    const deliverable: Array<{ id: string; status: string; event: WebhookEvent; scope: string }> = []
    for (const delivery of candidates) {
      const event = delivery.payload as unknown as WebhookEvent
      const scope =
        event && typeof event === 'object' && event.data ? resolveEventTenantScope(event) : null
      if (scope === null || !canDeliver(webhook.tenantId, scope)) {
        skipped++
        continue
      }
      deliverable.push({ id: delivery.id, status: delivery.status, event, scope })
    }

    const claimedIds = new Set(
      await webhooksRepository.markDeliveriesReplayed(
        db,
        webhook.id,
        deliverable.map((d) => d.id),
        [...statuses],
        new Date().toISOString()
      )
    )
    const claimed = deliverable.filter((d) => claimedIds.has(d.id))
    if (claimed.length === 0) {
      return { success: true, data: { replayed: 0, skipped, deliveryIds: [] } }
    }

    try {
      await queue.sendBatch(
        claimed.map((d) => ({
          body: {
            webhookId: webhook.id,
            eventPayload: d.event,
            webhookUrl: webhook.url,
            webhookSecret: webhook.secret,
            webhookHeaders: (webhook.headers as Record<string, string> | null) ?? undefined,
            maxRetries: normalizeRetryMaxRetries(webhook.retryMaxRetries),
            timeout: webhook.retryTimeout,
            tenantId: d.scope,
          },
        }))
      )
    } catch (err) {
      for (const d of claimed) {
        try {
          await webhooksRepository.updateDelivery(
            db,
            d.id,
            { status: d.status, nextRetryAt: null },
            webhook.id
          )
        } catch {
          // Best-effort restore; the row stays visible as pending.
        }
      }
      return {
        success: false,
        error: {
          code: 'QUEUE_UNAVAILABLE',
          message: `Failed to enqueue replay: ${err instanceof Error ? err.message : String(err)}`,
        },
      }
    }

    return {
      success: true,
      data: { replayed: claimed.length, skipped, deliveryIds: claimed.map((d) => d.id) },
    }
  },
}
