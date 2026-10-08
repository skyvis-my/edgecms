import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { EventType, WebhookEvent } from '../../webhooks/event-bus'

const { eventBus } = await import(`../../webhooks/event-bus?bypass=${Date.now()}`)

describe('EventBus', () => {
  beforeEach(() => {
    // Clear all listeners before each test
    eventBus.removeAllListeners()
  })

  describe('on() and emit()', () => {
    it('registers a listener and invokes it on emit', async () => {
      const mockListener = vi.fn()

      eventBus.on('entry.created', mockListener)

      await eventBus.emit('entry.created', {
        after: { id: 'entry1', title: 'New Post' },
        metadata: { userId: 'user1', source: 'admin' },
      })

      expect(mockListener).toHaveBeenCalledTimes(1)

      const event = mockListener.mock.calls[0]?.[0] as WebhookEvent
      expect(event.event).toBe('entry.created')
      expect(event.data.after).toEqual({ id: 'entry1', title: 'New Post' })
      expect(event.data.metadata).toEqual({ userId: 'user1', source: 'admin' })
      expect(event.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ) // UUID v4
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) // ISO 8601
    })

    it('supports multiple listeners for the same event', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      eventBus.on('entry.updated', listener1)
      eventBus.on('entry.updated', listener2)

      await eventBus.emit('entry.updated', {
        before: { id: 'entry1', title: 'Old Title' },
        after: { id: 'entry1', title: 'New Title' },
      })

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })

    it('does not invoke listeners for different event types', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      eventBus.on('entry.created', listener1)
      eventBus.on('entry.deleted', listener2)

      await eventBus.emit('entry.created', {
        after: { id: 'entry1' },
      })

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).not.toHaveBeenCalled()
    })

    it('supports async listeners', async () => {
      const asyncListener = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      eventBus.on('entry.published', asyncListener)

      await eventBus.emit('entry.published', {
        after: { id: 'entry1', status: 'published' },
      })

      expect(asyncListener).toHaveBeenCalledTimes(1)
    })

    it('handles listener errors gracefully without blocking other listeners', async () => {
      const failingListener = vi.fn(() => {
        throw new Error('Listener failed')
      })
      const successListener = vi.fn()

      eventBus.on('entry.created', failingListener)
      eventBus.on('entry.created', successListener)

      // Should not throw even though one listener fails
      await eventBus.emit('entry.created', { after: { id: 'entry1' } })

      expect(failingListener).toHaveBeenCalledTimes(1)
      expect(successListener).toHaveBeenCalledTimes(1)
    })
  })

  describe('off()', () => {
    it('removes a specific listener', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      eventBus.on('entry.created', listener1)
      eventBus.on('entry.created', listener2)

      eventBus.off('entry.created', listener1)

      await eventBus.emit('entry.created', { after: { id: 'entry1' } })

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalledTimes(1)
    })

    it('does not affect other event types when removing a listener', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      eventBus.on('entry.created', listener1)
      eventBus.on('entry.deleted', listener2)

      eventBus.off('entry.created', listener1)

      await eventBus.emit('entry.deleted', { after: { id: 'entry1' } })

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalledTimes(1)
    })
  })

  describe('removeAllListeners()', () => {
    it('removes all listeners for a specific event type', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      eventBus.on('entry.created', listener1)
      eventBus.on('entry.created', listener2)

      eventBus.removeAllListeners('entry.created')

      await eventBus.emit('entry.created', { after: { id: 'entry1' } })

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).not.toHaveBeenCalled()
    })

    it('removes all listeners for all event types when called without arguments', async () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      eventBus.on('entry.created', listener1)
      eventBus.on('entry.deleted', listener2)

      eventBus.removeAllListeners()

      await eventBus.emit('entry.created', { after: { id: 'entry1' } })
      await eventBus.emit('entry.deleted', { after: { id: 'entry2' } })

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).not.toHaveBeenCalled()
    })
  })

  describe('event payload structure', () => {
    it('includes a unique event ID for each emission', async () => {
      const listener = vi.fn()

      eventBus.on('entry.created', listener)

      await eventBus.emit('entry.created', { after: { id: 'entry1' } })
      await eventBus.emit('entry.created', { after: { id: 'entry2' } })

      const event1 = listener.mock.calls[0]?.[0] as WebhookEvent
      const event2 = listener.mock.calls[1]?.[0] as WebhookEvent

      expect(event1.id).not.toBe(event2.id)
    })

    it('includes an ISO 8601 timestamp', async () => {
      const listener = vi.fn()

      eventBus.on('entry.created', listener)

      const beforeEmit = Date.now()
      await eventBus.emit('entry.created', { after: { id: 'entry1' } })
      const afterEmit = Date.now()

      const event = listener.mock.calls[0]?.[0] as WebhookEvent

      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

      const eventTimestamp = new Date(event.timestamp).getTime()
      expect(eventTimestamp).toBeGreaterThanOrEqual(beforeEmit)
      expect(eventTimestamp).toBeLessThanOrEqual(afterEmit)
    })

    it('includes before, after, and metadata in data', async () => {
      const listener = vi.fn()

      eventBus.on('entry.updated', listener)

      await eventBus.emit('entry.updated', {
        before: { id: 'entry1', title: 'Old Title' },
        after: { id: 'entry1', title: 'New Title' },
        metadata: { userId: 'user1', source: 'admin' },
      })

      const event = listener.mock.calls[0]?.[0] as WebhookEvent

      expect(event.data.before).toEqual({ id: 'entry1', title: 'Old Title' })
      expect(event.data.after).toEqual({ id: 'entry1', title: 'New Title' })
      expect(event.data.metadata).toEqual({ userId: 'user1', source: 'admin' })
    })

    it('allows omitting before, after, or metadata', async () => {
      const listener = vi.fn()

      eventBus.on('entry.deleted', listener)

      await eventBus.emit('entry.deleted', {
        before: { id: 'entry1' },
      })

      const event = listener.mock.calls[0]?.[0] as WebhookEvent

      expect(event.data.before).toEqual({ id: 'entry1' })
      expect(event.data.after).toBeUndefined()
      expect(event.data.metadata).toBeUndefined()
    })
  })

  describe('all event types', () => {
    const eventTypes: EventType[] = [
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

    it.each(eventTypes)('supports event type: %s', async (eventType) => {
      const listener = vi.fn()

      eventBus.on(eventType, listener)

      await eventBus.emit(eventType, {
        after: { id: 'test-entity' },
      })

      expect(listener).toHaveBeenCalledTimes(1)

      const event = listener.mock.calls[0]?.[0] as WebhookEvent
      expect(event.event).toBe(eventType)
    })
  })
})
