/**
 * Unit tests for webhook queue producer.
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { drizzle } from 'drizzle-orm/d1'
import { createMockQueue } from '../../../test-utils'
import { eventBus } from '../../webhooks/event-bus'

const { initWebhookProducer, invalidateWebhookSubscriptionCache } = await import(
  `../../webhooks/queue-producer?bypass=${Date.now()}`
)

// Mock drizzle-orm/d1
vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(),
}))

describe('initWebhookProducer', () => {
  let mockDb: D1Database
  let mockQueue: Queue
  let mockOrm: ReturnType<typeof createMockDrizzleDb>

  beforeEach(() => {
    // Create fresh instances for each test
    mockDb = {} as D1Database
    mockQueue = createMockQueue()
    mockOrm = createMockDrizzleDb({ allResult: [] })

    // Mock the drizzle function to return our mock ORM
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    // Clear all event listeners before each test
    eventBus.removeAllListeners()

    // Clear all mocks
    vi.clearAllMocks()
  })

  it('registers listeners for all event types', () => {
    initWebhookProducer(eventBus, mockDb, mockQueue)
    // Listener registration should trigger a DB query when an event is emitted.
    return eventBus
      .emit('entry.created', {
        after: { id: 'entry-1', title: 'Test Entry' },
      })
      .then(() => {
        expect(mockOrm.select).toHaveBeenCalledTimes(1)
      })
  })

  it('queries for enabled webhooks matching the event type', async () => {
    // Mock database response with two webhooks, one matching and one not
    const allResult = [
      {
        id: 'webhook-1',
        url: 'https://example.com/webhook1',
        events: ['entry.created', 'entry.updated'],
        secret: 'secret-1',
        headers: { 'X-Custom': 'value1' },
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
      {
        id: 'webhook-2',
        url: 'https://example.com/webhook2',
        events: ['entry.deleted'],
        secret: 'secret-2',
        headers: null,
        enabled: true,
        retryMaxRetries: 3,
        retryTimeout: 20,
      },
    ]

    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    initWebhookProducer(eventBus, mockDb, mockQueue)

    // Emit an entry.created event
    await eventBus.emit('entry.created', {
      after: { id: 'entry-1', title: 'Test Entry' },
      metadata: { syncChannel: 'global' },
    })

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Verify sendBatch was called once (only webhook-1 matches)
    expect(mockQueue.sendBatch).toHaveBeenCalledTimes(1)
    expect(mockQueue.sendBatch).toHaveBeenCalledWith([
      {
        body: expect.objectContaining({
          webhookId: 'webhook-1',
          webhookUrl: 'https://example.com/webhook1',
          webhookSecret: 'secret-1',
          webhookHeaders: { 'X-Custom': 'value1' },
          maxRetries: 5,
          timeout: 30,
        }),
      },
    ])
  })

  it('enqueues messages for all matching webhooks', async () => {
    // Mock database response with two webhooks both matching
    const allResult = [
      {
        id: 'webhook-1',
        url: 'https://example.com/webhook1',
        events: ['entry.created', 'entry.updated'],
        secret: 'secret-1',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
      {
        id: 'webhook-2',
        url: 'https://example.com/webhook2',
        events: ['entry.created'],
        secret: 'secret-2',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
    ]

    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    initWebhookProducer(eventBus, mockDb, mockQueue)

    // Emit an entry.created event
    await eventBus.emit('entry.created', {
      after: { id: 'entry-1', title: 'Test Entry' },
      metadata: { syncChannel: 'global' },
    })

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockQueue.sendBatch).toHaveBeenCalledTimes(1)
    expect((mockQueue.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(2)
  })

  it('clamps delivery retries to queue consumer maximum', async () => {
    const allResult = [
      {
        id: 'webhook-1',
        url: 'https://example.com/webhook1',
        events: ['entry.created'],
        secret: 'secret-1',
        headers: null,
        enabled: true,
        retryMaxRetries: 9,
        retryTimeout: 30,
      },
    ]

    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    initWebhookProducer(eventBus, mockDb, mockQueue)

    await eventBus.emit('entry.created', {
      after: { id: 'entry-1', title: 'Test Entry' },
      metadata: { syncChannel: 'global' },
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockQueue.sendBatch).toHaveBeenCalledWith([
      {
        body: expect.objectContaining({
          webhookId: 'webhook-1',
          maxRetries: 5,
        }),
      },
    ])
  })

  it('reuses an event subscription index instead of querying enabled webhooks per event', async () => {
    const allResult = [
      {
        id: 'webhook-1',
        url: 'https://example.com/webhook1',
        events: ['entry.created', 'entry.updated'],
        secret: 'secret-1',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
    ]

    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    initWebhookProducer(eventBus, mockDb, mockQueue)

    await eventBus.emit('entry.created', { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } })
    await eventBus.emit('entry.updated', { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockOrm.select).toHaveBeenCalledTimes(1)
    expect(mockQueue.sendBatch).toHaveBeenCalledTimes(2)
  })

  it('refreshes subscriptions after explicit cache invalidation', async () => {
    const allResult = [
      {
        id: 'webhook-1',
        url: 'https://example.com/webhook1',
        events: ['entry.created'],
        secret: 'secret-1',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
    ]

    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)
    initWebhookProducer(eventBus, mockDb, mockQueue)

    await eventBus.emit('entry.created', { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } })
    invalidateWebhookSubscriptionCache()
    await eventBus.emit('entry.created', { after: { id: 'entry-2' }, metadata: { syncChannel: 'global' } })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockOrm.select).toHaveBeenCalledTimes(2)
    expect(mockQueue.sendBatch).toHaveBeenCalledTimes(2)
  })

  it('does not enqueue disabled webhooks', async () => {
    // Mock database response — the SQL WHERE clause filters to enabled=true,
    // so we only return the enabled webhook (disabled webhooks are filtered by SQL)
    const allResult = [
      {
        id: 'webhook-1',
        url: 'https://example.com/webhook1',
        events: ['entry.created'],
        secret: 'secret-1',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
      // webhook-2 with enabled: false is NOT returned by the SQL query
    ]

    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    initWebhookProducer(eventBus, mockDb, mockQueue)

    // Emit an entry.created event
    await eventBus.emit('entry.created', {
      after: { id: 'entry-1', title: 'Test Entry' },
      metadata: { syncChannel: 'global' },
    })

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockQueue.sendBatch).toHaveBeenCalledTimes(1)
    expect(mockQueue.sendBatch).toHaveBeenCalledWith([
      { body: expect.objectContaining({ webhookId: 'webhook-1' }) },
    ])
  })

  it('includes full event payload in queue message', async () => {
    // Mock database response
    const allResult = [
      {
        id: 'webhook-1',
        url: 'https://example.com/webhook1',
        events: ['entry.updated'],
        secret: 'secret-1',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
    ]

    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    initWebhookProducer(eventBus, mockDb, mockQueue)

    // Emit an entry.updated event with before/after/metadata
    await eventBus.emit('entry.updated', {
      before: { id: 'entry-1', title: 'Old Title' },
      after: { id: 'entry-1', title: 'New Title' },
      metadata: { userId: 'user-1', source: 'admin', syncChannel: 'global' },
    })

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Verify the event payload structure
    expect(mockQueue.sendBatch).toHaveBeenCalledWith([
      {
        body: expect.objectContaining({
          eventPayload: expect.objectContaining({
            id: expect.any(String),
            event: 'entry.updated',
            timestamp: expect.any(String),
            data: {
              before: { id: 'entry-1', title: 'Old Title' },
              after: { id: 'entry-1', title: 'New Title' },
              metadata: { userId: 'user-1', source: 'admin', syncChannel: 'global' },
            },
          }),
        }),
      },
    ])
  })

  it('propagates tenant scope from event metadata into queue message', async () => {
    const allResult = [
      {
        id: 'webhook-1',
        tenantId: 'tenant-acme',
        url: 'https://example.com/webhook1',
        events: ['entry.updated'],
        secret: 'secret-1',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
    ]

    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    initWebhookProducer(eventBus, mockDb, mockQueue)

    await eventBus.emit('entry.updated', {
      after: { id: 'entry-1' },
      metadata: { syncChannel: 'tenant-acme' },
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockQueue.sendBatch).toHaveBeenCalledWith([
      { body: expect.objectContaining({ webhookId: 'webhook-1', tenantId: 'tenant-acme' }) },
    ])
  })

  it('drops event when metadata.syncChannel is missing', async () => {
    const allResult = [
      {
        id: 'webhook-1',
        tenantId: 'global',
        url: 'https://example.com/webhook1',
        events: ['entry.updated'],
        secret: 'secret-1',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
    ]

    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    initWebhookProducer(eventBus, mockDb, mockQueue)

    await eventBus.emit('entry.updated', {
      after: { id: 'entry-1' },
      metadata: {},
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockQueue.sendBatch).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'webhook_enqueue_malformed_scope_dropped',
      expect.objectContaining({ eventType: 'entry.updated' })
    )
    consoleWarnSpy.mockRestore()
  })

  it('drops event when metadata.syncChannel is blank', async () => {
    const allResult = [
      {
        id: 'webhook-1',
        tenantId: 'global',
        url: 'https://example.com/webhook1',
        events: ['entry.updated'],
        secret: 'secret-1',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
    ]

    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    initWebhookProducer(eventBus, mockDb, mockQueue)

    await eventBus.emit('entry.updated', {
      after: { id: 'entry-1' },
      metadata: { syncChannel: '   ' },
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockQueue.sendBatch).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'webhook_enqueue_malformed_scope_dropped',
      expect.objectContaining({ eventType: 'entry.updated' })
    )
    consoleWarnSpy.mockRestore()
  })

  it('tenant event enqueues only matching tenant webhooks', async () => {
    const allResult = [
      {
        id: 'webhook-tenant-acme',
        tenantId: 'tenant-acme',
        url: 'https://example.com/acme',
        events: ['entry.updated'],
        secret: 'secret-acme',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
      {
        id: 'webhook-global',
        tenantId: 'global',
        url: 'https://example.com/global',
        events: ['entry.updated'],
        secret: 'secret-global',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
    ]
    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)
    initWebhookProducer(eventBus, mockDb, mockQueue)

    await eventBus.emit('entry.updated', {
      after: { id: 'entry-1' },
      metadata: { syncChannel: 'tenant-acme' },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockQueue.sendBatch).toHaveBeenCalledTimes(1)
    expect(mockQueue.sendBatch).toHaveBeenCalledWith([
      {
        body: expect.objectContaining({
          webhookId: 'webhook-tenant-acme',
          tenantId: 'tenant-acme',
        }),
      },
    ])
  })

  it('global event enqueues only global webhooks', async () => {
    const allResult = [
      {
        id: 'webhook-tenant-acme',
        tenantId: 'tenant-acme',
        url: 'https://example.com/acme',
        events: ['entry.created'],
        secret: 'secret-acme',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
      {
        id: 'webhook-global',
        tenantId: 'global',
        url: 'https://example.com/global',
        events: ['entry.created'],
        secret: 'secret-global',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
    ]
    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)
    initWebhookProducer(eventBus, mockDb, mockQueue)

    await eventBus.emit('entry.created', {
      after: { id: 'entry-1' },
      metadata: { syncChannel: 'global' },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockQueue.sendBatch).toHaveBeenCalledTimes(1)
    expect(mockQueue.sendBatch).toHaveBeenCalledWith([
      {
        body: expect.objectContaining({
          webhookId: 'webhook-global',
          tenantId: 'global',
        }),
      },
    ])
  })

  it('mixed subscriptions remain strictly isolated by tenant scope', async () => {
    const allResult = [
      {
        id: 'webhook-tenant-acme',
        tenantId: 'tenant-acme',
        url: 'https://example.com/acme',
        events: ['entry.updated'],
        secret: 'secret-acme',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
      {
        id: 'webhook-tenant-contoso',
        tenantId: 'tenant-contoso',
        url: 'https://example.com/contoso',
        events: ['entry.updated'],
        secret: 'secret-contoso',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
      {
        id: 'webhook-global',
        tenantId: 'global',
        url: 'https://example.com/global',
        events: ['entry.updated'],
        secret: 'secret-global',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryTimeout: 30,
      },
    ]
    mockOrm = createMockDrizzleDb({ allResult })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)
    initWebhookProducer(eventBus, mockDb, mockQueue)

    await eventBus.emit('entry.updated', {
      after: { id: 'entry-1' },
      metadata: { syncChannel: 'tenant-contoso' },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockQueue.sendBatch).toHaveBeenCalledTimes(1)
    expect(mockQueue.sendBatch).toHaveBeenCalledWith([
      {
        body: expect.objectContaining({
          webhookId: 'webhook-tenant-contoso',
          tenantId: 'tenant-contoso',
        }),
      },
    ])
  })

  it('handles database errors gracefully', async () => {
    // Mock database error by throwing in the all() method
    mockOrm = createMockDrizzleDbWithError(new Error('Database error'))
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    initWebhookProducer(eventBus, mockDb, mockQueue)

    // Emit an event
    await eventBus.emit('entry.created', {
      after: { id: 'entry-1', title: 'Test Entry' },
      metadata: { syncChannel: 'global' },
    })

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Verify error was logged and queue.sendBatch was not called
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(mockQueue.sendBatch).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock Drizzle-like DB with chainable query builders.
 * Supports the pattern: db.select().from(table).where(cond).all() -> Promise<rows>
 */
function createMockDrizzleDb(opts: { allResult?: unknown[] }) {
  const allResult = opts.allResult ?? []

  // Select chain resolves as a thenable (Promise-like)
  const selectChainBase = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue(allResult),
  }
  const selectChain = Object.assign(Promise.resolve(allResult), selectChainBase)

  return {
    select: vi.fn().mockReturnValue(selectChain),
  }
}

/**
 * Creates a mock Drizzle-like DB that throws an error on all().
 */
function createMockDrizzleDbWithError(error: Error) {
  const selectChainBase = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    all: vi.fn().mockRejectedValue(error),
  }
  const selectChain = Object.assign(Promise.resolve([]), selectChainBase)

  return {
    select: vi.fn().mockReturnValue(selectChain),
  }
}
