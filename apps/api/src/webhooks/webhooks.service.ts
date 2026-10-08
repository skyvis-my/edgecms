import type { Database } from '@/database/db'
import type { ServiceResult } from '@/shared/types/result'
import { invalidateWebhookSubscriptionCache } from './queue-producer'
import {
  type WebhookDestinationPolicy,
  validateWebhookDestination,
} from './webhook-destination-policy'
import { type WebhookRow, webhooksRepository } from './webhooks.repository'

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

function validateEvents(events: string[]): { valid: true } | { valid: false; error: string } {
  if (!events || events.length === 0) {
    return { valid: false, error: 'Events array must contain at least one event type' }
  }

  const invalidEvents = events.filter((e) => !VALID_EVENT_TYPES.includes(e))
  if (invalidEvents.length > 0) {
    return {
      valid: false,
      error: `Invalid event types: ${invalidEvents.join(', ')}. Valid types: ${VALID_EVENT_TYPES.join(', ')}`,
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
    policy?: WebhookDestinationPolicy
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
    const eventsValidation = validateEvents(input.events)
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
    policy?: WebhookDestinationPolicy
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
      const eventsValidation = validateEvents(input.events)
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
    tenantId?: string
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

    // Create test payload
    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { test: true },
    }

    // Send POST request to webhook URL
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'EdgeCMS-Webhook/1.0',
      }

      // Add custom headers if configured
      if (webhook.headers) {
        Object.assign(headers, webhook.headers)
      }

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(webhook.retryTimeout * 1000),
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
}
