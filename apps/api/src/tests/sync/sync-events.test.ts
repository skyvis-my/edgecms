import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { SyncEvent } from '../../sync/sync-events'

// Use cache-busted dynamic import to avoid cross-file mock contamination
const { publishSyncEvent, subscribeSyncEvents } = await import(
  `../../sync/sync-events?_t=${Date.now()}`
)

describe('sync-events', () => {
  // Track all unsubscribe functions so we can clean up after each test
  const unsubscribers: Array<() => void> = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Unsubscribe all listeners to prevent cross-test contamination
    for (const unsub of unsubscribers) {
      unsub()
    }
    unsubscribers.length = 0
    vi.restoreAllMocks()
  })

  function makeEvent(overrides: Partial<SyncEvent> = {}): SyncEvent {
    return {
      type: 'change',
      timestamp: '2024-01-01T00:00:00Z',
      ...overrides,
    }
  }

  // ==========================================================================
  // subscribeSyncEvents
  // ==========================================================================
  describe('subscribeSyncEvents', () => {
    it('returns an unsubscribe function', () => {
      const listener = vi.fn()
      const unsub = subscribeSyncEvents(listener)
      unsubscribers.push(unsub)

      expect(typeof unsub).toBe('function')
    })

    it('subscribes to default (global) channel when no channel specified', () => {
      const listener = vi.fn()
      const unsub = subscribeSyncEvents(listener)
      unsubscribers.push(unsub)

      publishSyncEvent(makeEvent())

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('subscribes to a specific channel', () => {
      const listener = vi.fn()
      const unsub = subscribeSyncEvents(listener, 'my-channel')
      unsubscribers.push(unsub)

      publishSyncEvent(makeEvent(), 'my-channel')

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('does not receive events from other channels', () => {
      const listener = vi.fn()
      const unsub = subscribeSyncEvents(listener, 'channel-a')
      unsubscribers.push(unsub)

      publishSyncEvent(makeEvent(), 'channel-b')

      expect(listener).not.toHaveBeenCalled()
    })

    it('unsubscribes correctly so listener no longer receives events', () => {
      const listener = vi.fn()
      const unsub = subscribeSyncEvents(listener)
      unsubscribers.push(unsub)

      unsub()
      publishSyncEvent(makeEvent())

      expect(listener).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // publishSyncEvent
  // ==========================================================================
  describe('publishSyncEvent', () => {
    it('publishes events to default channel listeners', () => {
      const listener = vi.fn()
      const unsub = subscribeSyncEvents(listener)
      unsubscribers.push(unsub)

      const event = makeEvent({ timestamp: '2024-06-15T12:00:00Z' })
      publishSyncEvent(event)

      expect(listener).toHaveBeenCalledWith(event)
    })

    it('publishes events to scoped channel listeners', () => {
      const listener = vi.fn()
      const unsub = subscribeSyncEvents(listener, 'tenant-1')
      unsubscribers.push(unsub)

      const event = makeEvent()
      publishSyncEvent(event, 'tenant-1')

      expect(listener).toHaveBeenCalledWith(event)
    })

    it('broadcasts to wildcard (*) listeners on any channel publish', () => {
      const wildcardListener = vi.fn()
      const unsub = subscribeSyncEvents(wildcardListener, '*')
      unsubscribers.push(unsub)

      const event = makeEvent()
      publishSyncEvent(event, 'some-specific-channel')

      expect(wildcardListener).toHaveBeenCalledWith(event)
    })

    it('does not double-notify wildcard listeners when publishing to wildcard channel', () => {
      const wildcardListener = vi.fn()
      const unsub = subscribeSyncEvents(wildcardListener, '*')
      unsubscribers.push(unsub)

      const event = makeEvent()
      publishSyncEvent(event, '*')

      // Wildcard listener should only be called once (as scoped listener, not additionally as wildcard)
      expect(wildcardListener).toHaveBeenCalledTimes(1)
    })

    it('notifies multiple listeners on the same channel', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      const unsub1 = subscribeSyncEvents(listener1, 'channel-a')
      const unsub2 = subscribeSyncEvents(listener2, 'channel-a')
      unsubscribers.push(unsub1, unsub2)

      const event = makeEvent()
      publishSyncEvent(event, 'channel-a')

      expect(listener1).toHaveBeenCalledWith(event)
      expect(listener2).toHaveBeenCalledWith(event)
    })

    it('does nothing when no listeners are registered', () => {
      // Should not throw
      expect(() => publishSyncEvent(makeEvent(), 'empty-channel')).not.toThrow()
    })

    it('catches and logs errors from failing listeners', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const failingListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error')
      })
      const healthyListener = vi.fn()

      const unsub1 = subscribeSyncEvents(failingListener)
      const unsub2 = subscribeSyncEvents(healthyListener)
      unsubscribers.push(unsub1, unsub2)

      publishSyncEvent(makeEvent())

      // Failing listener should not prevent healthy listener from executing
      expect(healthyListener).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith(
        'sync_event_listener_failed',
        expect.objectContaining({
          error: 'Listener error',
        })
      )

      consoleSpy.mockRestore()
    })

    it('logs non-Error exceptions from failing listeners', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const failingListener = vi.fn().mockImplementation(() => {
        throw 'string error' // eslint-disable-line no-throw-literal
      })

      const unsub = subscribeSyncEvents(failingListener)
      unsubscribers.push(unsub)

      publishSyncEvent(makeEvent())

      expect(consoleSpy).toHaveBeenCalledWith(
        'sync_event_listener_failed',
        expect.objectContaining({
          error: 'string error',
        })
      )

      consoleSpy.mockRestore()
    })
  })

  // ==========================================================================
  // Event format
  // ==========================================================================
  describe('event format', () => {
    it('passes complete SyncEvent object to listeners', () => {
      const listener = vi.fn()
      const unsub = subscribeSyncEvents(listener)
      unsubscribers.push(unsub)

      const event: SyncEvent = {
        type: 'change',
        timestamp: '2024-06-15T12:00:00Z',
      }
      publishSyncEvent(event)

      expect(listener).toHaveBeenCalledWith({
        type: 'change',
        timestamp: '2024-06-15T12:00:00Z',
      })
    })

    it('delivers the exact same event reference to all listeners', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      const unsub1 = subscribeSyncEvents(listener1)
      const unsub2 = subscribeSyncEvents(listener2)
      unsubscribers.push(unsub1, unsub2)

      const event = makeEvent()
      publishSyncEvent(event)

      expect(listener1.mock.calls[0]![0]).toBe(event)
      expect(listener2.mock.calls[0]![0]).toBe(event)
    })
  })

  // ==========================================================================
  // Channel isolation
  // ==========================================================================
  describe('channel isolation', () => {
    it('scoped and default channels are independent', () => {
      const globalListener = vi.fn()
      const scopedListener = vi.fn()

      const unsub1 = subscribeSyncEvents(globalListener)
      const unsub2 = subscribeSyncEvents(scopedListener, 'tenant-1')
      unsubscribers.push(unsub1, unsub2)

      publishSyncEvent(makeEvent())

      expect(globalListener).toHaveBeenCalledTimes(1)
      expect(scopedListener).not.toHaveBeenCalled()
    })

    it('wildcard listener receives events from both default and scoped channels', () => {
      const wildcardListener = vi.fn()
      const unsub = subscribeSyncEvents(wildcardListener, '*')
      unsubscribers.push(unsub)

      publishSyncEvent(makeEvent(), 'tenant-1')
      publishSyncEvent(makeEvent()) // default channel

      expect(wildcardListener).toHaveBeenCalledTimes(2)
    })
  })
})
