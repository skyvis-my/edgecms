/**
 * Tests for the outbox relay (H1 recovery) + producer outbox close-out.
 *
 * H1: a sendBatch failure leaves the row pending with backoff; a later relay
 * with a working queue drains it and marks it sent.
 */
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { drizzle } from 'drizzle-orm/d1'
import { createMockQueue } from '../../../test-utils'
import { eventBus } from '../../webhooks/event-bus'

const { relayOutbox, relayOutboxForCommand } = await import(
  `../../webhooks/outbox-relay?bypass=${Date.now()}`
)
const { initWebhookProducer } = await import(
  `../../webhooks/queue-producer?bypass=${Date.now()}`
)

vi.mock('drizzle-orm/d1', () => ({
  drizzle: vi.fn(),
}))

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outbox-1',
    eventId: 'evt-1',
    eventType: 'entry.created',
    payload: {
      event: 'entry.created',
      metadata: { syncChannel: 'global' },
      after: { id: 'e1' },
      before: null,
    },
    tenantScope: 'global',
    commandId: 'cmd-1',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function createOutboxDbMock(opts: { claimed?: unknown[] }) {
  const setValues: Record<string, unknown>[] = []
  const where = vi.fn().mockResolvedValue(undefined)
  const set = vi.fn().mockImplementation((v: Record<string, unknown>) => {
    setValues.push(v)
    return { where }
  })
  const all = vi.fn().mockResolvedValue(opts.claimed ?? [])
  const chain: Record<string, unknown> = { where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), all }
  ;(chain.where as ReturnType<typeof vi.fn>).mockImplementation(() => chain)
  ;(chain.orderBy as ReturnType<typeof vi.fn>).mockImplementation(() => chain)
  ;(chain.limit as ReturnType<typeof vi.fn>).mockImplementation(() => chain)
  return {
    setValues,
    where,
    db: {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(chain) }),
      update: vi.fn().mockReturnValue({ set }),
    },
  }
}

describe('relayOutbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventBus.removeAllListeners()
  })

  it('returns zero without touching the db when no queue is bound', async () => {
    const { db } = createOutboxDbMock({ claimed: [pendingRow()] })
    const result = await relayOutbox(db as never, undefined, async () => [])
    expect(result).toEqual({ relayed: 0, pending: 0 })
    expect(db.select).not.toHaveBeenCalled()
  })

  it('relays a claimed row and marks it sent (H1 recovery)', async () => {
    const { db, setValues } = createOutboxDbMock({ claimed: [pendingRow()] })
    const queue = createMockQueue()
    const message = { webhookId: 'w1', eventPayload: { id: 'evt-1' } }
    const result = await relayOutbox(
      db as never,
      queue as never,
      async () => [message] as never
    )
    expect(result).toEqual({ relayed: 1, pending: 0 })
    expect(queue.sendBatch).toHaveBeenCalledWith([{ body: message }])
    expect(setValues[0]).toMatchObject({ status: 'sent' })
  })

  it('leaves the row pending with +60s backoff when sendBatch throws (H1 crash window)', async () => {
    const { db, setValues } = createOutboxDbMock({ claimed: [pendingRow()] })
    const before = Date.now()
    const queue = { sendBatch: vi.fn().mockRejectedValue(new Error('queue down')) }
    const result = await relayOutbox(db as never, queue as never, async () => [{ webhookId: 'w1' }] as never)
    expect(result).toEqual({ relayed: 0, pending: 1 })
    expect(setValues[0]).toMatchObject({ status: 'pending' })
    const nextAttemptAt = Date.parse(setValues[0]?.nextAttemptAt as string)
    expect(nextAttemptAt).toBeGreaterThanOrEqual(before + 60_000 - 5_000)
  })

  it('relayOutboxForCommand sends a single event and returns message count', async () => {
    const { db, setValues } = createOutboxDbMock({ claimed: [] })
    const queue = createMockQueue()
    const event = {
      id: 'evt-9',
      event: 'entry.created',
      timestamp: '2025-01-01T00:00:00.000Z',
      data: { metadata: { syncChannel: 'global' } },
    }
    const sent = await relayOutboxForCommand(
      db as never,
      queue as never,
      event as never,
      async () => [{ webhookId: 'w1' }, { webhookId: 'w2' }] as never
    )
    expect(sent).toBe(2)
    expect(queue.sendBatch).toHaveBeenCalledTimes(1)
    expect(setValues[0]).toMatchObject({ status: 'sent' })
  })

  it('relayOutboxForCommand returns 0 for missing queue or event', async () => {
    const { db } = createOutboxDbMock({ claimed: [] })
    expect(await relayOutboxForCommand(db as never, undefined, null)).toBe(0)
  })
})

describe('producer outbox close-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventBus.removeAllListeners()
  })

  it('marks the outbox row sent after successful sendBatch', async () => {
    const setValues: Record<string, unknown>[] = []
    const where = vi.fn().mockResolvedValue(undefined)
    const set = vi.fn().mockImplementation((v: Record<string, unknown>) => {
      setValues.push(v)
      return { where }
    })
    const webhookRow = {
      id: 'webhook-1',
      tenantId: 'global',
      url: 'https://example.com/webhook',
      events: ['entry.created'],
      secret: 'secret-1',
      headers: null,
      enabled: true,
      retryMaxRetries: 5,
      retryTimeout: 30,
    }
    const selectChainBase = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue([webhookRow]),
    }
    const selectChain = Object.assign(Promise.resolve([webhookRow]), selectChainBase)
    const mockOrm = {
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue({ set }),
    }
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm)

    const queue = createMockQueue()
    initWebhookProducer(eventBus, {} as D1Database, queue as unknown as Queue)

    await eventBus.emit('entry.created', {
      after: { id: 'entry-1' },
      metadata: { syncChannel: 'global', outboxEventId: 'evt-1' },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(queue.sendBatch).toHaveBeenCalledTimes(1)
    expect(setValues[0]).toMatchObject({ status: 'sent' })
  })
})
