/**
 * DL-09 bulk replay of dead/failed deliveries for one webhook (real SQL).
 *
 * Breakage hypotheses:
 * - H1 bulk replay re-sends delivered or in-flight (pending) deliveries.
 * - H2 bulk replay reaches another webhook's or another tenant's deliveries.
 * - H3 an unbounded request enqueues every failed delivery at once.
 * - H4 a second replay while the first is in flight sends duplicates.
 * - H5 editors (not owner/admin) can trigger it.
 */
import { describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authorizeApiRequest } from '@/auth/authorization'
import type { Database } from '@/database/db'
import { webhookDeliveries } from '@/database/schema/webhooks.schema'
import type { WebhookQueueMessage } from '@/webhooks/queue-producer'
import { MAX_BULK_REPLAY, webhooksService } from '@/webhooks/webhooks.service'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const T0 = Date.parse('2026-01-01T00:00:00.000Z')

function setup() {
  const { d1, sqlite } = createSqliteD1()
  for (const [id, tenant] of <Array<[string, string]>>[
    ['wh-a', 'tenant-a'],
    ['wh-a2', 'tenant-a'],
    ['wh-b', 'tenant-b'],
  ]) {
    sqlite
      .query(
        `INSERT INTO webhooks (id, tenant_id, url, events, secret, enabled, retry_max_retries, retry_backoff, retry_timeout, created_at, updated_at)
         VALUES (?, ?, 'https://example.com/hook', '["entry.created"]', 'sec', 1, 3, 'exponential', 30, ?, ?)`
      )
      .run(id, tenant, new Date(T0).toISOString(), new Date(T0).toISOString())
  }
  return { db: drizzle(d1) as unknown as Database }
}

let seq = 0
async function addDelivery(
  db: Database,
  webhookId: string,
  status: string,
  opts: { tenant?: string; eventType?: string } = {}
) {
  seq++
  const id = `d-${seq}`
  await db.insert(webhookDeliveries).values({
    id,
    webhookId,
    eventId: `evt-${seq}`,
    eventType: opts.eventType ?? 'entry.created',
    payload: {
      id: `evt-${seq}`,
      event: opts.eventType ?? 'entry.created',
      timestamp: new Date(T0).toISOString(),
      data: { after: { id: 'e' }, metadata: { syncChannel: opts.tenant ?? 'tenant-a' } },
    },
    status,
    attempts: 3,
    createdAt: new Date(T0 + seq * 1000).toISOString(),
  })
  return id
}

async function statusOf(db: Database, id: string) {
  const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).all()
  return rows[0]?.status
}

function fakeQueue() {
  const sent: WebhookQueueMessage[] = []
  return {
    sent,
    queue: {
      send: async (body: WebhookQueueMessage) => void sent.push(body),
      sendBatch: async (messages: Array<{ body: WebhookQueueMessage }>) =>
        void sent.push(...messages.map((m) => m.body)),
    } as unknown as Queue<WebhookQueueMessage>,
  }
}

describe('webhooksService.replayDeliveries (bulk)', () => {
  it('H1/H2: re-enqueues only dead and failed deliveries of the one webhook', async () => {
    const { db } = setup()
    const dead = await addDelivery(db, 'wh-a', 'dead')
    const failed = await addDelivery(db, 'wh-a', 'failed')
    const delivered = await addDelivery(db, 'wh-a', 'delivered')
    const pending = await addDelivery(db, 'wh-a', 'pending')
    const testDelivery = await addDelivery(db, 'wh-a', 'failed', { eventType: 'test' })
    const otherWebhook = await addDelivery(db, 'wh-a2', 'failed')
    const { queue, sent } = fakeQueue()

    const result = await webhooksService.replayDeliveries(db, queue, 'wh-a', 'tenant-a')

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.replayed).toBe(2)
    expect(result.data.deliveryIds.sort()).toEqual([dead, failed].sort())
    expect(sent.map((m) => m.webhookId)).toEqual(['wh-a', 'wh-a'])
    expect(sent[0]?.webhookSecret).toBe('sec')
    expect(sent[0]?.tenantId).toBe('tenant-a')
    expect(await statusOf(db, dead)).toBe('pending')
    expect(await statusOf(db, failed)).toBe('pending')
    expect(await statusOf(db, delivered)).toBe('delivered')
    expect(await statusOf(db, pending)).toBe('pending')
    expect(await statusOf(db, testDelivery)).toBe('failed')
    expect(await statusOf(db, otherWebhook)).toBe('failed')
  })

  it('H2: another tenant gets NOT_FOUND and nothing is enqueued', async () => {
    const { db } = setup()
    const dead = await addDelivery(db, 'wh-a', 'dead')
    const { queue, sent } = fakeQueue()

    const result = await webhooksService.replayDeliveries(db, queue, 'wh-a', 'tenant-b')

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.code).toBe('NOT_FOUND')
    expect(sent).toHaveLength(0)
    expect(await statusOf(db, dead)).toBe('dead')
  })

  it('filters by status and honours the batch cap', async () => {
    const { db } = setup()
    const deadIds = [
      await addDelivery(db, 'wh-a', 'dead'),
      await addDelivery(db, 'wh-a', 'dead'),
      await addDelivery(db, 'wh-a', 'dead'),
    ]
    const failed = await addDelivery(db, 'wh-a', 'failed')
    const { queue, sent } = fakeQueue()

    const result = await webhooksService.replayDeliveries(db, queue, 'wh-a', 'tenant-a', {
      statuses: ['dead'],
      limit: 2,
    })

    expect(result.success && result.data.replayed).toBe(2)
    expect(sent).toHaveLength(2)
    // Oldest first.
    expect(await statusOf(db, deadIds[0]!)).toBe('pending')
    expect(await statusOf(db, deadIds[1]!)).toBe('pending')
    expect(await statusOf(db, deadIds[2]!)).toBe('dead')
    expect(await statusOf(db, failed)).toBe('failed')
  })

  it('H3: clamps an oversized limit to the max batch', async () => {
    const { db } = setup()
    for (let i = 0; i < MAX_BULK_REPLAY + 3; i++) await addDelivery(db, 'wh-a', 'failed')
    const { queue, sent } = fakeQueue()

    const result = await webhooksService.replayDeliveries(db, queue, 'wh-a', 'tenant-a', {
      limit: 10_000,
    })

    expect(result.success && result.data.replayed).toBe(MAX_BULK_REPLAY)
    expect(sent).toHaveLength(MAX_BULK_REPLAY)
  })

  it('H4: a second replay finds nothing while the first batch is in flight', async () => {
    const { db } = setup()
    await addDelivery(db, 'wh-a', 'dead')
    const { queue, sent } = fakeQueue()

    await webhooksService.replayDeliveries(db, queue, 'wh-a', 'tenant-a')
    const second = await webhooksService.replayDeliveries(db, queue, 'wh-a', 'tenant-a')

    expect(second.success && second.data.replayed).toBe(0)
    expect(sent).toHaveLength(1)
  })

  it('skips stored payloads whose scope does not match the webhook tenant', async () => {
    const { db } = setup()
    const forged = await addDelivery(db, 'wh-a', 'dead', { tenant: 'tenant-b' })
    const { queue, sent } = fakeQueue()

    const result = await webhooksService.replayDeliveries(db, queue, 'wh-a', 'tenant-a')

    expect(result.success && result.data).toMatchObject({ replayed: 0, skipped: 1 })
    expect(sent).toHaveLength(0)
    expect(await statusOf(db, forged)).toBe('dead')
  })

  it('returns QUEUE_UNAVAILABLE without touching rows when no queue is bound', async () => {
    const { db } = setup()
    const dead = await addDelivery(db, 'wh-a', 'dead')

    const result = await webhooksService.replayDeliveries(db, undefined, 'wh-a', 'tenant-a')

    expect(!result.success && result.error.code).toBe('QUEUE_UNAVAILABLE')
    expect(await statusOf(db, dead)).toBe('dead')
  })

  it('single-delivery replay also accepts dead deliveries', async () => {
    const { db } = setup()
    const dead = await addDelivery(db, 'wh-a', 'dead')
    const { queue, sent } = fakeQueue()

    const result = await webhooksService.replayDelivery(db, queue, 'wh-a', dead, 'tenant-a')

    expect(result.success).toBe(true)
    expect(sent).toHaveLength(1)
  })
})

describe('bulk replay authorization (owner/admin only)', () => {
  it('H5: forbids editors and allows admins', () => {
    for (const pathname of [
      '/api/admin/webhooks/wh-a/deliveries/replay',
      '/api/tenants/acme/api/admin/webhooks/wh-a/deliveries/replay',
    ]) {
      const editor = authorizeApiRequest({
        pathname,
        method: 'POST',
        principal: { actorId: 'u1', actorRole: 'editor', tenantRole: 'editor' },
      })
      expect(editor.allowed).toBe(false)
      const admin = authorizeApiRequest({
        pathname,
        method: 'POST',
        principal: { actorId: 'u2', actorRole: 'admin', tenantRole: 'admin' },
      })
      expect(admin).toEqual({ allowed: true })
    }
  })
})
