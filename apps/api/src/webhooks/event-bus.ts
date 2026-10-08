/**
 * Event bus for webhook delivery in EdgeCMS.
 *
 * Provides a type-safe event emitter that fires after successful command execution.
 * Events use dot-notation naming (e.g., entry.created, entry.updated) and include
 * before/after state for auditing and webhook delivery.
 */

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event type discriminant — identifies which event occurred.
 *
 * Naming convention: {entity}.{action}
 * - Entry lifecycle: entry.created, entry.updated, entry.deleted
 * - Entry publishing: entry.published, entry.unpublished, entry.scheduled
 * - Entry bulk: entry.bulk_updated
 * - Relations: relation.linked, relation.unlinked
 * - Collections: collection.created, collection.updated, collection.deleted
 */
import { logger } from '@/observability/logger'

export type EventType =
  | 'entry.created'
  | 'entry.updated'
  | 'entry.deleted'
  | 'entry.published'
  | 'entry.unpublished'
  | 'entry.scheduled'
  | 'entry.bulk_updated'
  | 'relation.linked'
  | 'relation.unlinked'
  | 'collection.created'
  | 'collection.updated'
  | 'collection.deleted'

/**
 * Webhook event payload structure.
 *
 * Every event emitted by the event bus follows this shape.
 *
 * @property id - Unique event ID (UUID v4)
 * @property event - Dot-notation event type (e.g., "entry.created")
 * @property timestamp - ISO 8601 timestamp of when the event occurred
 * @property data - Event payload with before/after state
 */
export interface WebhookEvent {
  id: string
  event: EventType
  timestamp: string
  data: {
    before?: unknown
    after?: unknown
    metadata?: unknown
  }
}

/**
 * Event listener callback signature.
 *
 * Listeners receive the full event payload and can perform async operations
 * (e.g., queueing webhook deliveries, triggering side effects).
 */
export type EventListener = (event: WebhookEvent) => void | Promise<void>

// ============================================================================
// Event Bus Implementation
// ============================================================================

/**
 * Event bus instance.
 *
 * Manages event listeners and dispatches events to registered callbacks.
 * This is a singleton pattern — only one event bus exists per worker instance.
 */
class EventBus {
  private listeners: Map<EventType, EventListener[]> = new Map()

  private dispatchEvent(callbacks: EventListener[], event: WebhookEvent): Promise<void> {
    return Promise.allSettled(
      callbacks.map(async (cb) => {
        try {
          await cb(event)
        } catch (err) {
          logger.error('event_listener_error', { error: err instanceof Error ? err.message : String(err) })
        }
      })
    ).then(() => undefined)
  }

  /**
   * Register an event listener.
   *
   * @param eventType - The event type to listen for (e.g., "entry.created")
   * @param callback - The function to invoke when the event is emitted
   *
   * @example
   * eventBus.on('entry.created', async (event) => {
   *   console.log('New entry created:', event.data.after)
   *   await queueWebhookDelivery(event)
   * })
   */
  on(eventType: EventType, callback: EventListener): void {
    const existing = this.listeners.get(eventType) || []
    this.listeners.set(eventType, [...existing, callback])
  }

  /**
   * Remove an event listener.
   *
   * @param eventType - The event type to stop listening for
   * @param callback - The callback to remove
   */
  off(eventType: EventType, callback: EventListener): void {
    const existing = this.listeners.get(eventType) || []
    this.listeners.set(
      eventType,
      existing.filter((cb) => cb !== callback)
    )
  }

  /**
   * Remove all listeners for a specific event type.
   *
   * @param eventType - The event type to clear listeners for
   */
  removeAllListeners(eventType?: EventType): void {
    if (eventType) {
      this.listeners.delete(eventType)
    } else {
      this.listeners.clear()
    }
  }

  /**
   * Emit an event to all registered listeners.
   *
   * Constructs a WebhookEvent with a unique ID and timestamp, then invokes
   * all registered callbacks for the event type.
   *
   * @param eventType - The event type to emit
   * @param data - Event payload with before/after state
   *
   * @example
   * eventBus.emit('entry.created', {
   *   after: { id: 'abc123', collectionId: 'col1', data: { title: 'New Post' } },
   *   metadata: { userId: 'user1', source: 'admin' }
   * })
   */
  async emit(
    eventType: EventType,
    data: {
      before?: unknown
      after?: unknown
      metadata?: unknown
    },
    options?: {
      mode?: 'async' | 'sync'
    }
  ): Promise<void> {
    const event: WebhookEvent = {
      id: crypto.randomUUID(),
      event: eventType,
      timestamp: new Date().toISOString(),
      data,
    }

    const callbacks = this.listeners.get(eventType) || []
    if (callbacks.length === 0) {
      return
    }

    if (options?.mode === 'sync') {
      await this.dispatchEvent(callbacks, event)
      return
    }

    // Dispatch out-of-band so webhook listeners do not block request latency.
    queueMicrotask(() => {
      void this.dispatchEvent(callbacks, event)
    })
  }

  async emitSync(
    eventType: EventType,
    data: {
      before?: unknown
      after?: unknown
      metadata?: unknown
    }
  ): Promise<void> {
    await this.emit(eventType, data, { mode: 'sync' })
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global event bus instance.
 *
 * Import this instance to register listeners or emit events.
 *
 * @example
 * import { eventBus } from '@/webhooks/event-bus'
 *
 * eventBus.on('entry.created', async (event) => {
 *   await notifyWebhooks(event)
 * })
 */
export const eventBus = new EventBus()
