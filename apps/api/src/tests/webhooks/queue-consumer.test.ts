/**
 * Unit tests for webhook queue consumer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { drizzle } from 'drizzle-orm/d1'
import type { Env } from '@/env'
import { createMockEnv } from '../../../test-utils'

const { handleQueue } = await import(`../../webhooks/queue-consumer?bypass=${Date.now()}`)

import type { WebhookQueueMessage } from '../../webhooks/queue-producer'

// Mock the global fetch function
const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

// Mock drizzle-orm/d1
vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(),
}))

describe('handleQueue', () => {
  let mockEnv: Env
  let mockOrm: ReturnType<typeof createMockDrizzleDb>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockEnv = createMockEnv()
    mockOrm = createMockDrizzleDb()
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)
  })

  afterEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it('delivers webhook successfully and records delivery', async () => {
    // Mock successful HTTP response
    mockFetch.mockResolvedValue(
      new Response('OK', {
        status: 200,
        statusText: 'OK',
      })
    )

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-1',
        event: 'entry.created',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1', title: 'Test Entry' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      webhookHeaders: { 'X-Custom': 'value' },
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }

    const mockMessage = {
      id: 'msg-1',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    const batch = createMessageBatch([mockMessage])

    await handleQueue(batch, mockEnv)

    // Verify fetch was called with correct parameters
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'User-Agent': 'EdgeCMS-Webhooks/1.0',
          'x-edgecms-signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
          'x-webhook-signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
        }),
        body: JSON.stringify(message.eventPayload),
      })
    )

    // Verify message was acknowledged
    expect(mockMessage.ack).toHaveBeenCalledTimes(1)
    expect(mockMessage.retry).not.toHaveBeenCalled()
  })

  it('dry-run revalidation delivery records signed payload without outbound fetch', async () => {
    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-revalidate-1',
        event: 'entry.published',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: {
          after: { id: 'entry-1', slug: 'hello-world' },
          metadata: {
            syncChannel: 'global',
            revalidate: {
              paths: ['/blog/hello-world'],
              tags: ['collection:posts', 'entry:entry-1', 'locale:en'],
            },
          },
        },
      },
      webhookUrl: 'https://example.com/revalidate',
      webhookSecret: 'test-secret',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
      dryRun: true,
    }
    const mockMessage = {
      id: 'msg-dry-run',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    await handleQueue(createMessageBatch([mockMessage]), mockEnv)

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockMessage.ack).toHaveBeenCalledTimes(1)
    expect(mockMessage.retry).not.toHaveBeenCalled()
    expect(mockOrm.insertValues[0]).toMatchObject({
      webhookId: 'webhook-1',
      eventId: 'event-revalidate-1',
      eventType: 'entry.published',
      status: 'delivered',
      attempts: 1,
      responseStatus: 204,
      responseBody: 'Dry-run delivery: signed payload validated without outbound fetch.',
    })
    expect(mockOrm.insertValues[0]?.payload).toMatchObject(message.eventPayload)
  })

  it('generates valid HMAC-SHA256 signature', async () => {
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-1',
        event: 'entry.created',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }

    const mockMessage = {
      id: 'msg-1',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    const batch = createMessageBatch([mockMessage])

    await handleQueue(batch, mockEnv)

    // Extract the signature from the fetch call
    const fetchCall = mockFetch.mock.calls[0]
    expect(fetchCall).toBeDefined()
    if (!fetchCall) {
      throw new Error('Expected fetch to be called at least once')
    }
    const headers = fetchCall[1].headers
    const signature = headers['x-edgecms-signature']

    // Verify signature format
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(headers['x-webhook-signature']).toBe(signature)

    // Verify signature is deterministic (same input = same signature)
    mockFetch.mockClear()
    await handleQueue(batch, mockEnv)
    const secondFetchCall = mockFetch.mock.calls[0]
    expect(secondFetchCall).toBeDefined()
    if (!secondFetchCall) {
      throw new Error('Expected fetch to be called a second time')
    }
    const secondSignature = secondFetchCall[1].headers['x-edgecms-signature']
    expect(signature).toBe(secondSignature)
  })

  it('retries on delivery failure with exponential backoff', async () => {
    // Mock failed HTTP response
    mockFetch.mockResolvedValue(
      new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
      })
    )

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-1',
        event: 'entry.created',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }

    const mockMessage = {
      id: 'msg-1',
      timestamp: new Date(),
      body: message,
      attempts: 2, // 3rd attempt
      ack: vi.fn(),
      retry: vi.fn(),
    }

    const batch = createMessageBatch([mockMessage])

    await handleQueue(batch, mockEnv)

    // Verify message was retried (not acknowledged)
    expect(mockMessage.retry).toHaveBeenCalledTimes(1)
    expect(mockMessage.ack).not.toHaveBeenCalled()
  })

  it('marks as failed after max retries exhausted', async () => {
    // Mock failed HTTP response
    mockFetch.mockResolvedValue(
      new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
      })
    )

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-1',
        event: 'entry.created',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }

    const mockMessage = {
      id: 'msg-1',
      timestamp: new Date(),
      body: message,
      attempts: 4, // 5th attempt (last one)
      ack: vi.fn(),
      retry: vi.fn(),
    }

    const batch = createMessageBatch([mockMessage])

    await handleQueue(batch, mockEnv)

    // Verify message was acknowledged (removed from queue)
    expect(mockMessage.ack).toHaveBeenCalledTimes(1)
    expect(mockMessage.retry).not.toHaveBeenCalled()

    // Verify error was logged
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('handles network errors', async () => {
    // Mock fetch error (network failure)
    mockFetch.mockRejectedValue(new Error('Network error'))

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-1',
        event: 'entry.created',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }

    const mockMessage = {
      id: 'msg-1',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    const batch = createMessageBatch([mockMessage])

    await handleQueue(batch, mockEnv)

    // Verify message was retried
    expect(mockMessage.retry).toHaveBeenCalledTimes(1)
    expect(mockMessage.ack).not.toHaveBeenCalled()
  })

  it('handles timeout by aborting request', async () => {
    // Mock fetch to reject with abort error (simulates timeout)
    mockFetch.mockRejectedValue(new Error('The operation was aborted'))

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-1',
        event: 'entry.created',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      maxRetries: 5,
      timeout: 1, // 1 second timeout
      tenantId: 'global',
    }

    const mockMessage = {
      id: 'msg-1',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    const batch = createMessageBatch([mockMessage])

    // This should timeout and retry
    await handleQueue(batch, mockEnv)

    // Verify message was retried (timeout treated as failure)
    expect(mockMessage.retry).toHaveBeenCalledTimes(1)
  })

  it('processes multiple messages in batch', async () => {
    // Mock successful HTTP response for both requests
    mockFetch.mockImplementation(() => Promise.resolve(new Response('OK', { status: 200 })))

    const message1: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-1',
        event: 'entry.created',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://example.com/webhook1',
      webhookSecret: 'secret-1',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }

    const message2: WebhookQueueMessage = {
      webhookId: 'webhook-2',
      eventPayload: {
        id: 'event-2',
        event: 'entry.updated',
        timestamp: '2025-01-01T00:00:01.000Z',
        data: { after: { id: 'entry-2' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://example.com/webhook2',
      webhookSecret: 'secret-2',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }

    const mockMessage1 = {
      id: 'msg-1',
      timestamp: new Date(),
      body: message1,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    const mockMessage2 = {
      id: 'msg-2',
      timestamp: new Date(),
      body: message2,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    const batch = createMessageBatch([mockMessage1, mockMessage2])

    await handleQueue(batch, mockEnv)

    // Verify both webhooks were delivered
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockMessage1.ack).toHaveBeenCalledTimes(1)
    // Check if either ack or retry was called for message 2
    const message2Processed =
      mockMessage2.ack.mock.calls.length + mockMessage2.retry.mock.calls.length
    expect(message2Processed).toBeGreaterThan(0)
  })

  it('includes custom headers in request', async () => {
    mockOrm = createMockDrizzleDb({
      webhookRows: [
        {
          id: 'webhook-1',
          tenantId: 'global',
          headers: {
            'X-Custom-Header': 'custom-value',
            Authorization: 'Bearer token123',
          },
        },
      ],
    })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-1',
        event: 'entry.created',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      webhookHeaders: { 'X-From-Queue': 'ignored' },
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }

    const mockMessage = {
      id: 'msg-1',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    const batch = createMessageBatch([mockMessage])

    await handleQueue(batch, mockEnv)

    // Verify custom headers were included
    const fetchCall = mockFetch.mock.calls[0]
    expect(fetchCall).toBeDefined()
    if (!fetchCall) {
      throw new Error('Expected fetch to be called')
    }
    const headers = fetchCall[1].headers
    expect(headers['X-Custom-Header']).toBe('custom-value')
    expect(headers.Authorization).toBe('Bearer token123')
  })

  it('uses the latest webhook config from the database instead of queued payload fields', async () => {
    mockOrm = createMockDrizzleDb({
      webhookRows: [
        {
          id: 'webhook-1',
          tenantId: 'global',
          url: 'https://db.example.com/webhook',
          secret: 'db-secret',
          headers: { 'X-From-Db': 'true' },
          enabled: true,
          retryMaxRetries: 5,
          retryTimeout: 30,
        },
      ],
    })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-1',
        event: 'entry.created',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://queued.example.com/webhook',
      webhookSecret: 'queued-secret',
      webhookHeaders: { 'X-From-Queue': 'true' },
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }
    const mockMessage = {
      id: 'msg-db-source',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    await handleQueue(createMessageBatch([mockMessage]), mockEnv)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://db.example.com/webhook',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-From-Db': 'true',
        }),
      })
    )
    expect(mockMessage.ack).toHaveBeenCalledTimes(1)
    expect(mockMessage.retry).not.toHaveBeenCalled()
  })

  it('acks and drops delivery when webhook is disabled in database', async () => {
    mockOrm = createMockDrizzleDb({
      webhookRows: [
        {
          id: 'webhook-1',
          tenantId: 'global',
          url: 'https://db.example.com/webhook',
          secret: 'db-secret',
          headers: null,
          enabled: false,
          retryMaxRetries: 5,
          retryTimeout: 30,
        },
      ],
    })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-disabled-1',
        event: 'entry.created',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://queued.example.com/webhook',
      webhookSecret: 'queued-secret',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }
    const mockMessage = {
      id: 'msg-disabled-1',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    await handleQueue(createMessageBatch([mockMessage]), mockEnv)

    expect(mockMessage.ack).toHaveBeenCalledTimes(1)
    expect(mockMessage.retry).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('handles unexpected errors during processing', async () => {
    // Mock database error by rejecting the insert operation
    const insertChain = {
      values: vi.fn().mockRejectedValue(new Error('Database error')),
    }
    mockOrm.insert.mockReturnValue(insertChain)
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-1',
        event: 'entry.created',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }

    const mockMessage = {
      id: 'msg-1',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    const batch = createMessageBatch([mockMessage])

    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

    await handleQueue(batch, mockEnv)

    // Verify error was logged
    expect(consoleErrorSpy).toHaveBeenCalled()

    // Verify message was retried to prevent data loss
    expect(mockMessage.retry).toHaveBeenCalledTimes(1)

    consoleErrorSpy.mockRestore()
  })

  it('drops tenant mismatch and logs warning', async () => {
    mockOrm = createMockDrizzleDb({
      webhookRows: [{ id: 'webhook-1', tenantId: 'global' }],
    })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-tenant-1',
        event: 'entry.updated',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'tenant-acme' } },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'tenant-acme',
    }

    const mockMessage = {
      id: 'msg-tenant-mismatch',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    await handleQueue(createMessageBatch([mockMessage]), mockEnv)

    expect(mockMessage.ack).toHaveBeenCalledTimes(1)
    expect(mockMessage.retry).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'webhook_delivery_scope_mismatch_dropped',
      expect.objectContaining({
        webhookId: 'webhook-1',
        eventId: 'event-tenant-1',
        resolvedEventScope: 'tenant-acme',
      })
    )

    consoleWarnSpy.mockRestore()
  })

  it('delivers when webhook tenant scope still matches event scope', async () => {
    mockOrm = createMockDrizzleDb({
      webhookRows: [{ id: 'webhook-1', tenantId: 'tenant-acme' }],
    })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-tenant-2',
        event: 'entry.updated',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'tenant-acme' } },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'tenant-acme',
    }

    const mockMessage = {
      id: 'msg-tenant-match',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    await handleQueue(createMessageBatch([mockMessage]), mockEnv)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockMessage.ack).toHaveBeenCalledTimes(1)
    expect(mockMessage.retry).not.toHaveBeenCalled()
  })

  it('acks and drops message when metadata.syncChannel is missing', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-malformed-1',
        event: 'entry.updated',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: {} },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }

    const mockMessage = {
      id: 'msg-malformed-1',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    await handleQueue(createMessageBatch([mockMessage]), mockEnv)

    expect(mockMessage.ack).toHaveBeenCalledTimes(1)
    expect(mockMessage.retry).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'webhook_delivery_malformed_scope_dropped',
      expect.objectContaining({ eventId: 'event-malformed-1' })
    )
    consoleWarnSpy.mockRestore()
  })

  it('acks and drops message when metadata.syncChannel is blank', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const message: WebhookQueueMessage = {
      webhookId: 'webhook-1',
      eventPayload: {
        id: 'event-malformed-2',
        event: 'entry.updated',
        timestamp: '2025-01-01T00:00:00.000Z',
        data: { after: { id: 'entry-1' }, metadata: { syncChannel: '  ' } },
      },
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'test-secret',
      maxRetries: 5,
      timeout: 30,
      tenantId: 'global',
    }

    const mockMessage = {
      id: 'msg-malformed-2',
      timestamp: new Date(),
      body: message,
      attempts: 0,
      ack: vi.fn(),
      retry: vi.fn(),
    }

    await handleQueue(createMessageBatch([mockMessage]), mockEnv)

    expect(mockMessage.ack).toHaveBeenCalledTimes(1)
    expect(mockMessage.retry).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'webhook_delivery_malformed_scope_dropped',
      expect.objectContaining({ eventId: 'event-malformed-2' })
    )
    consoleWarnSpy.mockRestore()
  })

  describe('dead-letter retry logic', () => {
    it('retries failed delivery with exponential backoff delay calculation when attempts < maxRetries', async () => {
      mockFetch.mockResolvedValue(new Response('Server Error', { status: 500 }))

      const message: WebhookQueueMessage = {
        webhookId: 'webhook-1',
        eventPayload: {
          id: 'event-retry-1',
          event: 'entry.published',
          timestamp: '2026-01-01T00:00:00.000Z',
          data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
        },
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'test-secret',
        maxRetries: 5,
        timeout: 30,
        tenantId: 'global',
      }

      // attempt = 1 (msg.attempts = 0), currentAttempt = 1, delay = 10 * 3^0 = 10s
      const mockMessage1 = {
        id: 'msg-retry-1',
        timestamp: new Date(),
        body: message,
        attempts: 0,
        ack: vi.fn(),
        retry: vi.fn(),
      }
      await handleQueue(createMessageBatch([mockMessage1]), mockEnv)
      expect(mockMessage1.retry).toHaveBeenCalledWith(
        expect.objectContaining({ delaySeconds: expect.any(Number) })
      )
      const d1 = (mockMessage1.retry.mock.calls[0]![0] as { delaySeconds: number }).delaySeconds
      expect(d1).toBeGreaterThanOrEqual(5)
      expect(d1).toBeLessThanOrEqual(10)
      expect(mockMessage1.ack).not.toHaveBeenCalled()

      // attempt = 2 (msg.attempts = 1), currentAttempt = 2, jittered between 5 and 20s
      const mockMessage2 = {
        id: 'msg-retry-2',
        timestamp: new Date(),
        body: message,
        attempts: 1,
        ack: vi.fn(),
        retry: vi.fn(),
      }
      await handleQueue(createMessageBatch([mockMessage2]), mockEnv)
      expect(mockMessage2.retry).toHaveBeenCalledWith(
        expect.objectContaining({ delaySeconds: expect.any(Number) })
      )
      const d2 = (mockMessage2.retry.mock.calls[0]![0] as { delaySeconds: number }).delaySeconds
      expect(d2).toBeGreaterThanOrEqual(5)
      expect(d2).toBeLessThanOrEqual(20)

      // attempt = 3 (msg.attempts = 2), currentAttempt = 3, jittered between 5 and 40s
      const mockMessage3 = {
        id: 'msg-retry-3',
        timestamp: new Date(),
        body: message,
        attempts: 2,
        ack: vi.fn(),
        retry: vi.fn(),
      }
      await handleQueue(createMessageBatch([mockMessage3]), mockEnv)
      expect(mockMessage3.retry).toHaveBeenCalledWith(
        expect.objectContaining({ delaySeconds: expect.any(Number) })
      )
      const d3 = (mockMessage3.retry.mock.calls[0]![0] as { delaySeconds: number }).delaySeconds
      expect(d3).toBeGreaterThanOrEqual(5)
      expect(d3).toBeLessThanOrEqual(40)
    })

    it('exhausts retries and commits dead-letter terminal failure with msg.ack() when attempts >= maxRetries', async () => {
      mockFetch.mockResolvedValue(new Response('Permanent Error', { status: 500 }))

      const message: WebhookQueueMessage = {
        webhookId: 'webhook-1',
        eventPayload: {
          id: 'event-dead-letter-1',
          event: 'entry.deleted',
          timestamp: '2026-01-01T00:00:00.000Z',
          data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
        },
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'test-secret',
        maxRetries: 5,
        timeout: 30,
        tenantId: 'global',
      }

      // 5th attempt on maxRetries=5 -> exhausted!
      const mockMessage = {
        id: 'msg-dead-1',
        timestamp: new Date(),
        body: message,
        attempts: 4, // currentAttempt becomes 5 (>= maxRetries)
        ack: vi.fn(),
        retry: vi.fn(),
      }

      await handleQueue(createMessageBatch([mockMessage]), mockEnv)

      expect(mockMessage.ack).toHaveBeenCalledTimes(1)
      expect(mockMessage.retry).not.toHaveBeenCalled()

      // Verify delivery record status is 'failed' and nextRetryAt is null
      const failedDelivery = mockOrm.insertValues.find(
        (v) => v.eventId === 'event-dead-letter-1'
      )
      expect(failedDelivery).toBeDefined()
      expect(failedDelivery?.status).toBe('failed')
      expect(failedDelivery?.nextRetryAt).toBeNull()
      expect(failedDelivery?.attempts).toBe(5)
    })

    it('re-enqueues message with msg.retry() on unexpected uncaught runtime exception', async () => {
      // Cause an unexpected throw inside deliverWebhook or message processing
      mockFetch.mockImplementation(() => {
        throw new Error('Fatal socket segmentation fault')
      })

      const message: WebhookQueueMessage = {
        webhookId: 'webhook-1',
        eventPayload: {
          id: 'event-err-1',
          event: 'entry.created',
          timestamp: '2026-01-01T00:00:00.000Z',
          data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
        },
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'test-secret',
        maxRetries: 5,
        timeout: 30,
        tenantId: 'global',
      }

      const mockMessage = {
        id: 'msg-err-1',
        timestamp: new Date(),
        body: message,
        attempts: 1,
        ack: vi.fn(),
        retry: vi.fn(),
      }

      await handleQueue(createMessageBatch([mockMessage]), mockEnv)

      // On unexpected exception, message is retried to prevent silent data drop
      expect(mockMessage.retry).toHaveBeenCalledTimes(1)
      expect(mockMessage.ack).not.toHaveBeenCalled()
    })

    it('handles destination rejected by destination policy as dead-letter terminal failure', async () => {
      const blockedOrm = createMockDrizzleDb({
        webhookRows: [
          {
            id: 'webhook-blocked',
            tenantId: 'global',
            url: 'http://169.254.169.254/metadata',
          },
        ],
      })
      ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(blockedOrm)

      const message: WebhookQueueMessage = {
        webhookId: 'webhook-blocked',
        eventPayload: {
          id: 'event-blocked-1',
          event: 'entry.created',
          timestamp: '2026-01-01T00:00:00.000Z',
          data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
        },
        webhookUrl: 'http://169.254.169.254/metadata',
        webhookSecret: 'test-secret',
        maxRetries: 5,
        timeout: 30,
        tenantId: 'global',
      }

      const mockMessage = {
        id: 'msg-blocked-1',
        timestamp: new Date(),
        body: message,
        attempts: 0,
        ack: vi.fn(),
        retry: vi.fn(),
      }

      await handleQueue(createMessageBatch([mockMessage]), mockEnv)

      // Blocked destinations are immediately acknowledged to avoid spamming restricted IPs
      expect(mockMessage.ack).toHaveBeenCalledTimes(1)
      expect(mockMessage.retry).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('processes batch containing mixed outcomes: success, retry with backoff, and dead-letter failure', async () => {
      mockFetch.mockImplementation(async (_url, init) => {
        const bodyStr = String(init?.body ?? '')
        if (bodyStr.includes('"ev-1"')) {
          return new Response('OK', { status: 200 })
        }
        return new Response('Error', { status: 500 })
      })

      const msgSuccess = {
        id: 'batch-success',
        timestamp: new Date(),
        body: {
          webhookId: 'webhook-1',
          eventPayload: {
            id: 'ev-1',
            event: 'entry.created',
            timestamp: '',
            data: { after: {}, metadata: { syncChannel: 'global' } },
          },
          webhookUrl: 'https://example.com/success',
          webhookSecret: 'secret',
          maxRetries: 5,
          timeout: 30,
          tenantId: 'global',
        } as WebhookQueueMessage,
        attempts: 0,
        ack: vi.fn(),
        retry: vi.fn(),
      }

      const msgRetry = {
        id: 'batch-retry',
        timestamp: new Date(),
        body: {
          webhookId: 'webhook-1',
          eventPayload: {
            id: 'ev-2',
            event: 'entry.updated',
            timestamp: '',
            data: { after: {}, metadata: { syncChannel: 'global' } },
          },
          webhookUrl: 'https://example.com/fail',
          webhookSecret: 'secret',
          maxRetries: 5,
          timeout: 30,
          tenantId: 'global',
        } as WebhookQueueMessage,
        attempts: 1, // currentAttempt = 2 < 5
        ack: vi.fn(),
        retry: vi.fn(),
      }

      const msgDeadLetter = {
        id: 'batch-dead',
        timestamp: new Date(),
        body: {
          webhookId: 'webhook-1',
          eventPayload: {
            id: 'ev-3',
            event: 'entry.deleted',
            timestamp: '',
            data: { after: {}, metadata: { syncChannel: 'global' } },
          },
          webhookUrl: 'https://example.com/fail',
          webhookSecret: 'secret',
          maxRetries: 5,
          timeout: 30,
          tenantId: 'global',
        } as WebhookQueueMessage,
        attempts: 4, // currentAttempt = 5 >= 5
        ack: vi.fn(),
        retry: vi.fn(),
      }

      await handleQueue(createMessageBatch([msgSuccess, msgRetry, msgDeadLetter]), mockEnv)

      // msgSuccess: delivered -> ack
      expect(msgSuccess.ack).toHaveBeenCalledTimes(1)
      expect(msgSuccess.retry).not.toHaveBeenCalled()

      // msgRetry: retry with backoff -> retry({ delaySeconds })
      expect(msgRetry.retry).toHaveBeenCalledWith(
        expect.objectContaining({ delaySeconds: expect.any(Number) })
      )
      const mixedDelay = (msgRetry.retry.mock.calls[0]![0] as { delaySeconds: number }).delaySeconds
      expect(mixedDelay).toBeGreaterThanOrEqual(5)
      expect(mixedDelay).toBeLessThanOrEqual(20)
      expect(msgRetry.ack).not.toHaveBeenCalled()

      // msgDeadLetter: max retries reached -> ack
      expect(msgDeadLetter.ack).toHaveBeenCalledTimes(1)
      expect(msgDeadLetter.retry).not.toHaveBeenCalled()
    })

    it('deduplicates webhook config queries across multiple messages in a batch', async () => {
      mockFetch.mockImplementation(() => Promise.resolve(new Response('OK', { status: 200 })))

      const msg1 = {
        id: 'msg-batch-1',
        timestamp: new Date(),
        body: {
          webhookId: 'webhook-shared',
          eventPayload: {
            id: 'ev-shared-1',
            event: 'entry.created',
            timestamp: '',
            data: { after: {}, metadata: { syncChannel: 'global' } },
          },
          webhookUrl: 'https://example.com/shared',
          webhookSecret: 'secret',
          maxRetries: 5,
          timeout: 30,
          tenantId: 'global',
        } as WebhookQueueMessage,
        attempts: 0,
        ack: vi.fn(),
        retry: vi.fn(),
      }

      const msg2 = {
        id: 'msg-batch-2',
        timestamp: new Date(),
        body: {
          webhookId: 'webhook-shared',
          eventPayload: {
            id: 'ev-shared-2',
            event: 'entry.updated',
            timestamp: '',
            data: { after: {}, metadata: { syncChannel: 'global' } },
          },
          webhookUrl: 'https://example.com/shared',
          webhookSecret: 'secret',
          maxRetries: 5,
          timeout: 30,
          tenantId: 'global',
        } as WebhookQueueMessage,
        attempts: 0,
        ack: vi.fn(),
        retry: vi.fn(),
      }

      await handleQueue(createMessageBatch([msg1, msg2]), mockEnv)

      expect(msg1.ack).toHaveBeenCalledTimes(1)
      expect(msg2.ack).toHaveBeenCalledTimes(1)
      // Webhook config is looked up once, and deliveries are prefetched in bulk across the batch
      // Total selects = 1 webhook + 1 delivery prefetch = 2 (instead of 4 without batch dedup)
      expect(mockOrm.select).toHaveBeenCalledTimes(2)
    })

    it('deduplicates both webhook and idempotency queries when messages share event and webhook', async () => {
      mockFetch.mockImplementation(() => Promise.resolve(new Response('OK', { status: 200 })))

      const msg1 = {
        id: 'msg-dup-1',
        timestamp: new Date(),
        body: {
          webhookId: 'webhook-dup',
          eventPayload: {
            id: 'ev-same-1',
            event: 'entry.created',
            timestamp: '',
            data: { after: {}, metadata: { syncChannel: 'global' } },
          },
          webhookUrl: 'https://example.com/dup',
          webhookSecret: 'secret',
          maxRetries: 5,
          timeout: 30,
          tenantId: 'global',
        } as WebhookQueueMessage,
        attempts: 0,
        ack: vi.fn(),
        retry: vi.fn(),
      }

      const msg2 = {
        id: 'msg-dup-2',
        timestamp: new Date(),
        body: {
          webhookId: 'webhook-dup',
          eventPayload: {
            id: 'ev-same-1',
            event: 'entry.created',
            timestamp: '',
            data: { after: {}, metadata: { syncChannel: 'global' } },
          },
          webhookUrl: 'https://example.com/dup',
          webhookSecret: 'secret',
          maxRetries: 5,
          timeout: 30,
          tenantId: 'global',
        } as WebhookQueueMessage,
        attempts: 0,
        ack: vi.fn(),
        retry: vi.fn(),
      }

      await handleQueue(createMessageBatch([msg1, msg2]), mockEnv)

      expect(msg1.ack).toHaveBeenCalledTimes(1)
      expect(msg2.ack).toHaveBeenCalledTimes(1)
      // 1 select for webhook + 1 select for existing delivery = 2 queries total (instead of 4)
      expect(mockOrm.select).toHaveBeenCalledTimes(2)
    })

    it('caches delivery state in memory on failure to avoid re-querying D1', async () => {
      mockFetch.mockImplementation(() => Promise.resolve(new Response('Error', { status: 500 })))

      const msg1 = {
        id: 'msg-fail-1',
        timestamp: new Date(),
        body: {
          webhookId: 'webhook-fail',
          eventPayload: {
            id: 'ev-fail-1',
            event: 'entry.created',
            timestamp: '',
            data: { after: {}, metadata: { syncChannel: 'global' } },
          },
          webhookUrl: 'https://example.com/fail',
          webhookSecret: 'secret',
          maxRetries: 5,
          timeout: 30,
          tenantId: 'global',
        } as WebhookQueueMessage,
        attempts: 0,
        ack: vi.fn(),
        retry: vi.fn(),
      }

      const msg2 = {
        id: 'msg-fail-2',
        timestamp: new Date(),
        body: {
          webhookId: 'webhook-fail',
          eventPayload: {
            id: 'ev-fail-1',
            event: 'entry.created',
            timestamp: '',
            data: { after: {}, metadata: { syncChannel: 'global' } },
          },
          webhookUrl: 'https://example.com/fail',
          webhookSecret: 'secret',
          maxRetries: 5,
          timeout: 30,
          tenantId: 'global',
        } as WebhookQueueMessage,
        attempts: 0,
        ack: vi.fn(),
        retry: vi.fn(),
      }

      await handleQueue(createMessageBatch([msg1, msg2]), mockEnv)

      // Total selects is 2 (1 webhook config + 1 delivery lookup, cached for second message)
      expect(mockOrm.select).toHaveBeenCalledTimes(2)
    })
  })
})


// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock Drizzle-like DB with support for insert operations.
 * Supports the pattern: db.insert(table).values(data) -> Promise<void>
 */
function createMockDrizzleDb(opts?: {
  webhookRows?: Array<{
    id: string
    tenantId: string
    url?: string
    secret?: string
    headers?: Record<string, string> | null
    enabled?: boolean
    retryMaxRetries?: number
    retryTimeout?: number
  }>
}) {
  const insertValues: Record<string, unknown>[] = []
  const webhookRows = (opts?.webhookRows ?? [{ id: 'webhook-1', tenantId: 'global' }]).map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    url: row.url ?? 'https://example.com/webhook',
    secret: row.secret ?? 'test-secret',
    headers: row.headers ?? null,
    enabled: row.enabled ?? true,
    retryMaxRetries: row.retryMaxRetries ?? 5,
    retryTimeout: row.retryTimeout ?? 30,
  }))
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue(webhookRows),
  }

  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn((value: Record<string, unknown>) => {
        insertValues.push(value)
        return Promise.resolve(undefined)
      }),
    })),
    insertValues,
  }
}

function createMessageBatch(
  messages: Message<WebhookQueueMessage>[]
): MessageBatch<WebhookQueueMessage> {
  return {
    messages,
    queue: 'edgecms-webhook-queue',
    metadata: {
      metrics: {
        backlogCount: 0,
        backlogBytes: 0,
      },
    },
    retryAll: vi.fn(),
    ackAll: vi.fn(),
  }
}
