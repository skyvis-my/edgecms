/**
 * DL-09 dead-letter queue consumer (real SQL via bun:sqlite).
 *
 * Breakage hypotheses:
 * - H1 a message that exhausted queue retries vanishes with no delivery record.
 * - H2 a dead-letter message overwrites a delivery that already succeeded.
 * - H3 a forged/mis-scoped message records a delivery on another tenant's webhook.
 * - H4 the main queue handler treats dead-letter batches as live deliveries (re-POST).
 */
import { describe, expect, it, vi } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { webhookDeliveries } from '@/database/schema/webhooks.schema'
import type { Env } from '@/env'
import {
  dispatchWebhookQueue,
  handleDeadLetterQueue,
  isWebhookDeadLetterQueue,
} from '@/webhooks/queue-consumer'
import type { WebhookQueueMessage } from '@/webhooks/queue-producer'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const NOW = '2026-01-01T00:00:00.000Z'

function setup() {
  const { d1, sqlite } = createSqliteD1()
  for (const [id, tenant] of <Array<[string, string]>>[
    ['wh-a', 'tenant-a'],
    ['wh-b', 'tenant-b'],
  ]) {
    sqlite
      .query(
        `INSERT INTO webhooks (id, tenant_id, url, events, secret, enabled, retry_max_retries, retry_backoff, retry_timeout, created_at, updated_at)
         VALUES (?, ?, 'https://example.com/hook', '["entry.created"]', 's', 1, 3, 'exponential', 30, ?, ?)`
      )
      .run(id, tenant, NOW, NOW)
  }
  return { d1, db: drizzle(d1), env: { DB: d1 } as unknown as Env }
}

function message(webhookId: string, eventId: string, syncChannel: string): WebhookQueueMessage {
  return {
    webhookId,
    eventPayload: {
      id: eventId,
      event: 'entry.created',
      timestamp: NOW,
      data: { after: { id: 'e1' }, metadata: { syncChannel } },
    },
    webhookUrl: 'https://example.com/hook',
    webhookSecret: 's',
    maxRetries: 3,
    timeout: 30,
    tenantId: syncChannel,
  } as WebhookQueueMessage
}

function batchOf(queue: string, bodies: WebhookQueueMessage[]) {
  const messages = bodies.map((body, i) => ({
    id: `m-${i}`,
    body,
    attempts: 5,
    ack: vi.fn(),
    retry: vi.fn(),
  }))
  return { batch: { queue, messages } as unknown as MessageBatch<WebhookQueueMessage>, messages }
}

async function deliveryOf(db: ReturnType<typeof drizzle>, webhookId: string, eventId: string) {
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.webhookId, webhookId), eq(webhookDeliveries.eventId, eventId)))
    .all()
  return rows[0]
}

describe('isWebhookDeadLetterQueue', () => {
  it('matches the declared DLQ names for every environment only', () => {
    expect(isWebhookDeadLetterQueue('edgecms-webhook-dlq')).toBe(true)
    expect(isWebhookDeadLetterQueue('edgecms-webhook-dlq-staging')).toBe(true)
    expect(isWebhookDeadLetterQueue('edgecms-webhook-dlq-production')).toBe(true)
    expect(isWebhookDeadLetterQueue('edgecms-webhook-queue')).toBe(false)
    expect(isWebhookDeadLetterQueue('edgecms-webhook-queue-production')).toBe(false)
    expect(isWebhookDeadLetterQueue(undefined)).toBe(false)
  })
})

describe('handleDeadLetterQueue', () => {
  it('H1: records the delivery as dead and acks the message', async () => {
    const { db, env } = setup()
    const { batch, messages } = batchOf('edgecms-webhook-dlq', [message('wh-a', 'evt-1', 'tenant-a')])

    await handleDeadLetterQueue(batch, env)

    const row = await deliveryOf(db, 'wh-a', 'evt-1')
    expect(row?.status).toBe('dead')
    expect(row?.attempts).toBe(5)
    expect(row?.nextRetryAt).toBeNull()
    expect(messages[0]?.ack).toHaveBeenCalled()
  })

  it('H1: moves an existing pending delivery to dead', async () => {
    const { db, env } = setup()
    await db.insert(webhookDeliveries).values({
      id: 'd-1',
      webhookId: 'wh-a',
      eventId: 'evt-1',
      eventType: 'entry.created',
      payload: {},
      status: 'pending',
      attempts: 2,
      responseStatus: 500,
      responseBody: 'boom',
      createdAt: NOW,
    })
    const { batch } = batchOf('edgecms-webhook-dlq', [message('wh-a', 'evt-1', 'tenant-a')])

    await handleDeadLetterQueue(batch, env)

    const row = await deliveryOf(db, 'wh-a', 'evt-1')
    expect(row?.id).toBe('d-1')
    expect(row?.status).toBe('dead')
    expect(row?.responseStatus).toBe(500)
  })

  it('H2: never downgrades a delivered row', async () => {
    const { db, env } = setup()
    await db.insert(webhookDeliveries).values({
      id: 'd-ok',
      webhookId: 'wh-a',
      eventId: 'evt-ok',
      eventType: 'entry.created',
      payload: {},
      status: 'delivered',
      attempts: 1,
      createdAt: NOW,
    })
    const { batch, messages } = batchOf('edgecms-webhook-dlq', [message('wh-a', 'evt-ok', 'tenant-a')])

    await handleDeadLetterQueue(batch, env)

    expect((await deliveryOf(db, 'wh-a', 'evt-ok'))?.status).toBe('delivered')
    expect(messages[0]?.ack).toHaveBeenCalled()
  })

  it('H3: drops messages whose event scope does not match the webhook tenant', async () => {
    const { db, env } = setup()
    const { batch, messages } = batchOf('edgecms-webhook-dlq', [
      message('wh-b', 'evt-x', 'tenant-a'),
      message('wh-missing', 'evt-y', 'tenant-a'),
    ])

    await handleDeadLetterQueue(batch, env)

    expect(await deliveryOf(db, 'wh-b', 'evt-x')).toBeUndefined()
    expect(messages[0]?.ack).toHaveBeenCalled()
    expect(messages[1]?.ack).toHaveBeenCalled()
  })
})

describe('dispatchWebhookQueue', () => {
  it('H4: routes dead-letter batches to the DLQ handler without any outbound fetch', async () => {
    const { db, env } = setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { batch } = batchOf('edgecms-webhook-dlq-production', [message('wh-a', 'evt-2', 'tenant-a')])

    await dispatchWebhookQueue(batch, env)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect((await deliveryOf(db, 'wh-a', 'evt-2'))?.status).toBe('dead')
    fetchSpy.mockRestore()
  })
})
