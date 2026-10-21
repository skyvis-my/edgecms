import { logger } from '@/observability/logger'
import { eventBus as defaultEventBus, type EventType } from '@/webhooks/event-bus'
import type {
  ResolvedHostPolicies,
  TenantEventType,
  TenantLifecycleEvent,
} from './host-policies'

type TenantSnapshot = TenantLifecycleEvent['tenant']

type EventBusLike = {
  emit: (
    eventType: EventType,
    data: { before?: unknown; after?: unknown; metadata?: unknown },
    options?: { mode?: 'async' | 'sync' }
  ) => Promise<void>
}

export interface TenantEventPublisher {
  publish(
    event: TenantEventType,
    tenant: TenantSnapshot,
    details?: { previousStatus?: string; actorId?: string }
  ): Promise<void>
}

/**
 * Lifecycle event emitted when a tenant moves from `previousStatus` to
 * `nextStatus`, or null when the transition has no event (HS-08).
 */
export function tenantStatusTransitionEvent(
  previousStatus: string,
  nextStatus: string
): TenantEventType | null {
  if (previousStatus === nextStatus) return null
  if (nextStatus === 'active') return 'tenant.activated'
  if (nextStatus === 'suspended') return 'tenant.suspended'
  return null
}

/**
 * Publishes tenant lifecycle events (HS-08) to the webhook event bus and the
 * host's `onTenantEvent` listener. One publisher per app instance.
 *
 * Webhook scope is `global`: lifecycle events are operator events, so only
 * global webhooks (subscribable by super-admins) receive them, never a
 * tenant's. Both deliveries are awaited so they finish inside the request:
 * these events have no outbox row for the relay to replay, and lifecycle
 * changes are rare admin operations. Hosts should keep `onTenantEvent` fast
 * (enqueue work rather than call slow APIs). Failures are logged and never
 * fail the committed change.
 */
export function createTenantEventPublisher(
  host: Pick<ResolvedHostPolicies, 'onTenantEvent'>,
  bus: EventBusLike = defaultEventBus
): TenantEventPublisher {
  return {
    async publish(event, tenant, details = {}) {
      const snapshot: TenantSnapshot = {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
      }
      try {
        await bus.emit(
          event,
          {
            after: snapshot,
            metadata: {
              syncChannel: 'global',
              tenantId: snapshot.id,
              previousStatus: details.previousStatus,
              actorId: details.actorId,
            },
          },
          // Await webhook enqueueing so the Worker does not drop it after the response.
          { mode: 'sync' }
        )
      } catch (err) {
        logger.error('tenant_event_bus_emit_failed', {
          event,
          tenantId: snapshot.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }

      if (!host.onTenantEvent) return
      const payload: TenantLifecycleEvent = {
        id: crypto.randomUUID(),
        event,
        timestamp: new Date().toISOString(),
        tenant: snapshot,
        ...(details.previousStatus !== undefined && { previousStatus: details.previousStatus }),
        ...(details.actorId !== undefined && { actorId: details.actorId }),
      }
      try {
        await host.onTenantEvent(payload)
      } catch (err) {
        logger.error('host_tenant_event_listener_failed', {
          event,
          tenantId: snapshot.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
  }
}
