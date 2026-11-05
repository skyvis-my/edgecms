/**
 * DL-09 scheduled outbox sweeper (real SQL via bun:sqlite).
 *
 * Breakage hypotheses:
 * - H1 a noisy tenant starves other tenants' outbox rows in one sweep.
 * - H2 the sweeper races the producer listener and re-sends fresh rows.
 * - H3 a permanently failing row retries forever at a fixed delay.
 * - H4 two overlapping sweeps (cron + engine post-execution) both send a row.
 * - H5 dead rows are relayed again.
 */
import { describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { webhookOutbox } from '@/database/schema/webhooks.schema'
import type { Database } from '@/database/db'
import type { WebhookEvent } from '@/webhooks/event-bus'
import {
  OUTBOX_MAX_ATTEMPTS,
  computeOutboxRetryDelayMs,
  relayOutbox,
} from '@/webhooks/outbox-relay'
import { runScheduledOutboxSweep, sweepOutbox } from '@/webhooks/outbox-sweeper'
import type { WebhookQueueMessage } from '@/webhooks/queue-producer'
import type { Env } from '@/env'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const OLD = '2026-01-01T00:00:00.000Z'

function setup() {
  const { d1, sqlite } = createSqliteD1()
  const db = drizzle(d1) as unknown as Database
  return { d1, sqlite, db }
}

async function insertRow(
  db: Database,
  eventId: string,
  tenantScope: string,
  overrides: Partial<typeof webhookOutbox.$inferInsert> = {}
) {
  await db.insert(webhookOutbox).values({
    id: `row-${eventId}`,
    eventId,
    eventType: 'entry.created',
    payload: { event: 'entry.created', metadata: { syncChannel: tenantScope }, after: { id: eventId } },
    tenantScope,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    createdAt: OLD,
    ...overrides,
  })
}

async function rowOf(db: Database, eventId: string) {
  const rows = await db.select().from(webhookOutbox).where(eq(webhookOutbox.eventId, eventId)).all()
  return rows[0]
}

function fakeQueue(opts: { fail?: boolean } = {}) {
  const sent: WebhookQueueMessage[] = []
  return {
    sent,
    queue: {
      send: async (body: WebhookQueueMessage) => {
        if (opts.fail) throw new Error('queue down')
        sent.push(body)
      },
      sendBatch: async (messages: Array<{ body: WebhookQueueMessage }>) => {
        if (opts.fail) throw new Error('queue down')
        sent.push(...messages.map((m) => m.body))
      },
    } as unknown as Queue<WebhookQueueMessage>,
  }
}

const oneMessagePerEvent = async (event: WebhookEvent) =>
  [{ webhookId: 'wh-1', eventPayload: event } as unknown as WebhookQueueMessage]

describe('computeOutboxRetryDelayMs', () => {
  it('grows exponentially with jitter inside [cap/2, cap] and stops at one hour', () => {
    expect(computeOutboxRetryDelayMs(1, () => 0)).toBe(30_000)
    expect(computeOutboxRetryDelayMs(1, () => 1)).toBe(60_000)
    expect(computeOutboxRetryDelayMs(3, () => 0)).toBe(120_000)
    expect(computeOutboxRetryDelayMs(3, () => 1)).toBe(240_000)
    expect(computeOutboxRetryDelayMs(30, () => 1)).toBe(3_600_000)
    expect(computeOutboxRetryDelayMs(30, () => 0)).toBe(1_800_000)
    const jittered = computeOutboxRetryDelayMs(2, () => 0.5)
    expect(jittered).toBeGreaterThan(60_000)
    expect(jittered).toBeLessThan(120_000)
  })
})

describe('sweepOutbox (scheduled sweeper)', () => {
  it('H1: relays due rows per tenant in bounded batches so one tenant cannot starve another', async () => {
    const { db } = setup()
    for (let i = 0; i < 5; i++) await insertRow(db, `a-${i}`, 'tenant-a')
    await insertRow(db, 'b-0', 'tenant-b', { createdAt: '2026-01-02T00:00:00.000Z' })
    const { queue, sent } = fakeQueue()

    const result = await sweepOutbox(db, queue, oneMessagePerEvent, { perTenantLimit: 2 })

    expect(result.tenants).toBe(2)
    expect(result.relayed).toBe(3)
    expect(sent.map((m) => m.eventPayload.id).sort()).toEqual(['a-0', 'a-1', 'b-0'])
    expect((await rowOf(db, 'b-0'))?.status).toBe('sent')
    expect((await rowOf(db, 'a-4'))?.status).toBe('pending')
  })

  it('caps the total rows relayed per sweep', async () => {
    const { db } = setup()
    for (let i = 0; i < 4; i++) await insertRow(db, `a-${i}`, 'tenant-a')
    for (let i = 0; i < 4; i++) await insertRow(db, `b-${i}`, 'tenant-b')
    const { queue, sent } = fakeQueue()

    const result = await sweepOutbox(db, queue, oneMessagePerEvent, {
      perTenantLimit: 10,
      maxRows: 5,
    })

    expect(result.relayed).toBe(5)
    expect(sent).toHaveLength(5)
  })

  it('H2: leaves fresh rows to the producer listener', async () => {
    const { db } = setup()
    await insertRow(db, 'fresh', 'tenant-a', { createdAt: new Date().toISOString() })
    const { queue, sent } = fakeQueue()

    const result = await sweepOutbox(db, queue, oneMessagePerEvent)

    expect(result.relayed).toBe(0)
    expect(sent).toHaveLength(0)
    expect((await rowOf(db, 'fresh'))?.status).toBe('pending')
  })

  it('H3: backs off exponentially and moves the row to dead after the attempt cap', async () => {
    const { db } = setup()
    await insertRow(db, 'doomed', 'tenant-a')
    const { queue } = fakeQueue({ fail: true })

    const before = Date.now()
    const first = await sweepOutbox(db, queue, oneMessagePerEvent)
    expect(first.relayed).toBe(0)
    let row = await rowOf(db, 'doomed')
    expect(row?.status).toBe('pending')
    expect(row?.attempts).toBe(1)
    const delay = Date.parse(row?.nextAttemptAt ?? '') - before
    expect(delay).toBeGreaterThanOrEqual(30_000 - 1_000)
    expect(delay).toBeLessThanOrEqual(60_000 + 1_000)

    // Fast-forward to the last allowed attempt.
    await db
      .update(webhookOutbox)
      .set({ attempts: OUTBOX_MAX_ATTEMPTS - 1, nextAttemptAt: null })
      .where(eq(webhookOutbox.eventId, 'doomed'))
    const last = await sweepOutbox(db, queue, oneMessagePerEvent)
    expect(last.dead).toBe(1)
    row = await rowOf(db, 'doomed')
    expect(row?.status).toBe('dead')
    expect(row?.attempts).toBe(OUTBOX_MAX_ATTEMPTS)
    expect(row?.nextAttemptAt).toBeNull()
  })

  it('H5: never relays dead rows', async () => {
    const { db } = setup()
    await insertRow(db, 'dead-1', 'tenant-a', { status: 'dead', attempts: OUTBOX_MAX_ATTEMPTS })
    const { queue, sent } = fakeQueue()

    const result = await sweepOutbox(db, queue, oneMessagePerEvent)

    expect(result.relayed).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it('H4: overlapping relays send each row once (lease before send)', async () => {
    const { db } = setup()
    await insertRow(db, 'once', 'tenant-a')
    const { queue, sent } = fakeQueue()

    await Promise.all([
      relayOutbox(db, queue, oneMessagePerEvent, { staleOnlyMs: 60_000 }),
      relayOutbox(db, queue, oneMessagePerEvent, { staleOnlyMs: 60_000 }),
      sweepOutbox(db, queue, oneMessagePerEvent),
    ])

    expect(sent).toHaveLength(1)
    expect((await rowOf(db, 'once'))?.status).toBe('sent')
  })
})

describe('runScheduledOutboxSweep (Worker scheduled entry)', () => {
  it('relays due rows through the bound queue using live subscriptions', async () => {
    const { d1, db, sqlite } = setup()
    sqlite
      .query(
        `INSERT INTO webhooks (id, tenant_id, url, events, secret, enabled, retry_max_retries, retry_backoff, retry_timeout, created_at, updated_at)
         VALUES ('wh-a', 'tenant-a', 'https://example.com/a', '["entry.created"]', 's', 1, 3, 'exponential', 30, ?, ?)`
      )
      .run(OLD, OLD)
    await insertRow(db, 'evt-a', 'tenant-a')
    await insertRow(db, 'evt-b', 'tenant-b')
    const { queue, sent } = fakeQueue()

    const result = await runScheduledOutboxSweep({ DB: d1, WEBHOOK_QUEUE: queue } as unknown as Env)

    expect(result?.relayed).toBe(2)
    // Tenant B has no subscription: its row is closed without a message.
    expect(sent.map((m) => [m.webhookId, m.eventPayload.id])).toEqual([['wh-a', 'evt-a']])
    expect((await rowOf(db, 'evt-b'))?.status).toBe('sent')
  })

  it('is a no-op without a queue binding', async () => {
    const { d1 } = setup()
    expect(await runScheduledOutboxSweep({ DB: d1 } as unknown as Env)).toBeNull()
  })
})
