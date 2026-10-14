/**
 * Consumer dedup tests (H2).
 *
 * H2: queue at-least-once redelivery must not double-insert
 * webhook_deliveries rows and inflate retry accounting. Idempotency key =
 * eventId (scoped per webhookId).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { drizzle } from 'drizzle-orm/d1'
import type { Env } from '@/env'
import { createMockEnv } from '../../../test-utils'
import { webhooks } from '../../database/schema/webhooks.schema'

const { handleQueue } = await import(`../../webhooks/queue-consumer?bypass=${Date.now()}`)

import type { WebhookQueueMessage } from '../../webhooks/queue-producer'

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(),
}))

const WEBHOOK_ROW = {
  id: 'webhook-1',
  tenantId: 'global',
  url: 'https://example.com/webhook',
  secret: 'test-secret',
  headers: null,
  enabled: true,
  retryMaxRetries: 5,
  retryTimeout: 30,
}

function buildMessage(eventId: string): WebhookQueueMessage {
  return {
    webhookId: 'webhook-1',
    eventPayload: {
      id: eventId,
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
}

function queueMessage(body: WebhookQueueMessage, attempts = 0) {
  return { id: `msg-${body.eventPayload.id}`, timestamp: new Date(), body, attempts, ack: vi.fn(), retry: vi.fn() }
}

/** Fake drizzle db enforcing UNIQUE(event_id, webhook_id) on deliveries. */
function createDedupDb() {
  const deliveries: Record<string, unknown>[] = []
  const setCalls: Record<string, unknown>[] = []
  /** Emulates the SQL WHERE(event_id, webhook_id) filter of the lookup. */
  const filter = { eventId: '', webhookId: 'webhook-1' }
  const makeChain = (allImpl: () => Promise<unknown[]>) => {
    const chain = { where: vi.fn(), limit: vi.fn(), all: vi.fn().mockImplementation(allImpl) }
    chain.where.mockImplementation(() => chain)
    chain.limit.mockImplementation(() => chain)
    return chain
  }
  return {
    deliveries,
    setCalls,
    filter,
    db: {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation((table: unknown) => {
          if (table === webhooks) return makeChain(async () => [{ ...WEBHOOK_ROW }])
          return makeChain(async () =>
            deliveries.filter(
              (d) => d.eventId === filter.eventId && d.webhookId === filter.webhookId
            )
          )
        }),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn((v: Record<string, unknown>) => {
          if (
            deliveries.some((d) => d.eventId === v.eventId && d.webhookId === v.webhookId)
          ) {
            return Promise.reject(
              new Error('UNIQUE constraint failed: webhook_deliveries.event_id, webhook_id')
            )
          }
          deliveries.push(v)
          return Promise.resolve(undefined)
        }),
      })),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((v: Record<string, unknown>) => {
          setCalls.push(v)
          if (deliveries[0]) Object.assign(deliveries[0], v)
          return { where: vi.fn().mockResolvedValue(undefined) }
        }),
      })),
    },
  }
}

function createBatch(messages: ReturnType<typeof queueMessage>[]) {
  return {
    messages,
    queue: 'edgecms-webhook-queue',
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    retryAll: vi.fn(),
    ackAll: vi.fn(),
  } as unknown as MessageBatch<WebhookQueueMessage>
}

describe('queue consumer dedup (H2)', () => {
  let mockEnv: Env

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockEnv = createMockEnv()
  })

  afterEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it('delivering the same event twice yields one delivery row and one POST', async () => {
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))
    const fake = createDedupDb()
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fake.db)

    const first = queueMessage(buildMessage('event-dedup-1'))
    fake.filter.eventId = 'event-dedup-1'
    await handleQueue(createBatch([first]), mockEnv)
    expect(first.ack).toHaveBeenCalledTimes(1)
    expect(fake.deliveries).toHaveLength(1)

    const second = queueMessage(buildMessage('event-dedup-1'))
    await handleQueue(createBatch([second]), mockEnv)
    expect(second.ack).toHaveBeenCalledTimes(1)
    expect(second.retry).not.toHaveBeenCalled()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(fake.deliveries).toHaveLength(1)
    expect(fake.deliveries[0]).toMatchObject({
      eventId: 'event-dedup-1',
      webhookId: 'webhook-1',
      status: 'delivered',
      attempts: 1,
    })
  })

  it('concurrent redelivery race collapses UNIQUE violation into an update, not a second row', async () => {
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))
    const fake = createDedupDb()
    // Pre-seed a pending row so the pre-delivery delivered-check passes
    // through, then force the insert to collide.
    fake.deliveries.push({
      id: 'seed',
      webhookId: 'webhook-1',
      eventId: 'event-race-1',
      eventType: 'entry.created',
      payload: {},
      status: 'pending',
      attempts: 1,
      lastAttemptAt: '2025-01-01T00:00:00.000Z',
      nextRetryAt: null,
      responseStatus: 500,
      responseBody: 'err',
      createdAt: '2025-01-01T00:00:00.000Z',
    })
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fake.db)

    const msg = queueMessage(buildMessage('event-race-1'))
    fake.filter.eventId = 'event-race-1'
    await handleQueue(createBatch([msg]), mockEnv)

    expect(msg.ack).toHaveBeenCalledTimes(1)
    expect(fake.deliveries).toHaveLength(1)
    expect(fake.deliveries[0]).toMatchObject({ status: 'delivered', attempts: 1 })
    expect(fake.setCalls).toHaveLength(1)
  })

  it('different events still produce separate delivery rows', async () => {
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))
    const fake = createDedupDb()
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fake.db)

    fake.filter.eventId = 'event-a'
    await handleQueue(createBatch([queueMessage(buildMessage('event-a'))]), mockEnv)
    fake.filter.eventId = 'event-b'
    await handleQueue(createBatch([queueMessage(buildMessage('event-b'))]), mockEnv)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(fake.deliveries).toHaveLength(2)
  })
})
