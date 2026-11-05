import { and, asc, eq, isNull, lte, min, or, sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { webhookOutbox } from '@/database/schema/webhooks.schema'
import { logger } from '@/observability/logger'

/**
 * Transactional webhook outbox repository.
 *
 * H1 durability: the command engine writes one row here in the SAME db.batch()
 * as the processed command + audit rows (see engine recordCommand). A crash
 * between DB commit and queue.sendBatch leaves a 'pending' row that
 * outbox-relay replays — the webhook is never lost.
 *
 * All methods are mock-driver tolerant: missing chain methods (limit, orderBy,
 * onConflictDoNothing, update) fall back to JS-side equivalents or safe no-ops,
 * following the ttl.service / commands.repository patterns.
 */

export type OutboxEntry = {
  eventId: string
  eventType: string
  payload: Record<string, unknown>
  tenantScope?: string
  commandId?: string | null
}

export type OutboxRow = typeof webhookOutbox.$inferSelect

/**
 * True when the error (or any wrapped `cause`, e.g. Drizzle's
 * "Failed query: ..." DrizzleQueryError) is a UNIQUE/constraint violation.
 */
export function isUniqueConstraintViolation(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current != null; depth++) {
    const message = current instanceof Error ? current.message : String(current)
    if (/unique|SQLITE_CONSTRAINT/i.test(message)) return true
    current = current instanceof Error ? (current as Error & { cause?: unknown }).cause : undefined
  }
  return false
}

export function outboxInsertValues(entry: OutboxEntry, now = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    eventId: entry.eventId,
    eventType: entry.eventType,
    payload: entry.payload,
    tenantScope: entry.tenantScope ?? 'global',
    commandId: entry.commandId ?? null,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null as string | null,
    createdAt: now,
  }
}

export const outboxRepository = {
  /**
   * Enqueue an event. Double-enqueue of the same eventId is a no-op
   * (UNIQUE on event_id) so retries of the same command never duplicate rows.
   */
  async enqueue(db: Database, entry: OutboxEntry): Promise<void> {
    const values = outboxInsertValues(entry)
    try {
      const builder = db.insert(webhookOutbox).values(values) as unknown as {
        onConflictDoNothing?: (args: unknown) => Promise<unknown>
      } & PromiseLike<unknown>
      if (builder && typeof builder.onConflictDoNothing === 'function') {
        await builder.onConflictDoNothing({ target: webhookOutbox.eventId })
        return
      }
      await builder
    } catch (err) {
      if (isUniqueConstraintViolation(err)) return
      throw err
    }
  },

  /**
   * Claim up to `limit` pending rows, oldest first. Rows with a future
   * nextAttemptAt are skipped. Pass staleOnlyMs to only claim rows created
   * before now-staleOnlyMs (opportunistic orphan replay without touching
   * fresh rows the producer listener is about to send).
   */
  async claimPending(
    db: Database,
    limit = 20,
    opts?: { staleOnlyMs?: number; tenantScope?: string }
  ): Promise<OutboxRow[]> {
    const conditions = dueConditions(opts?.staleOnlyMs)
    if (opts?.tenantScope !== undefined) {
      conditions.push(eq(webhookOutbox.tenantScope, opts.tenantScope))
    }
    const chain = db
      .select()
      .from(webhookOutbox)
      .where(and(...conditions)) as unknown as {
      orderBy?: (order: unknown) => unknown
      limit?: (n: number) => unknown
      all?: () => Promise<OutboxRow[]>
    } & PromiseLike<OutboxRow[]>

    // Full chain (real D1 + capable mocks): ordered + limited in SQL.
    if (typeof chain.orderBy === 'function') {
      const ordered = chain.orderBy(asc(webhookOutbox.createdAt)) as unknown as {
        limit?: (n: number) => unknown
        all?: () => Promise<OutboxRow[]>
      } & PromiseLike<OutboxRow[]>
      if (typeof ordered.limit === 'function') {
        const limited = ordered.limit(limit) as unknown as {
          all?: () => Promise<OutboxRow[]>
        } & PromiseLike<OutboxRow[]>
        if (typeof limited.all === 'function') return limited.all()
        return (await limited) as OutboxRow[]
      }
      if (typeof ordered.all === 'function') return (await ordered.all()).slice(0, limit)
      return ((await ordered) as OutboxRow[]).slice(0, limit)
    }
    // Legacy mock drivers without orderBy: JS-side cap.
    if (typeof chain.all === 'function') return (await chain.all()).slice(0, limit)
    return ((await chain) as OutboxRow[]).slice(0, limit)
  },

  /** Mark a row sent after successful queue.sendBatch. */
  async markSent(db: Database, eventId: string): Promise<void> {
    await applyOutboxUpdate(db, eventId, {
      status: 'sent',
      nextAttemptAt: null,
    })
  },

  /** Leave a row pending with a backoff after a failed relay (attempts + 1). */
  async markFailed(db: Database, eventId: string, nextAttemptAt: string): Promise<void> {
    await applyOutboxUpdate(db, eventId, {
      status: 'pending',
      nextAttemptAt,
    })
  },

  /** Terminal state after the attempt cap: never claimed again (attempts + 1). */
  async markDead(db: Database, eventId: string): Promise<void> {
    await applyOutboxUpdate(db, eventId, {
      status: 'dead',
      nextAttemptAt: null,
    })
  },

  /**
   * Distinct tenant scopes with due rows, oldest backlog first. The scheduled
   * sweeper relays each scope in its own bounded batch so one noisy tenant
   * cannot starve the others.
   */
  async listDueTenantScopes(
    db: Database,
    limit = 25,
    opts?: { staleOnlyMs?: number }
  ): Promise<string[]> {
    const rows = await db
      .select({ tenantScope: webhookOutbox.tenantScope, oldest: min(webhookOutbox.createdAt) })
      .from(webhookOutbox)
      .where(and(...dueConditions(opts?.staleOnlyMs)))
      .groupBy(webhookOutbox.tenantScope)
      .orderBy(asc(min(webhookOutbox.createdAt)))
      .limit(limit)
      .all()
    return rows.map((row) => row.tenantScope)
  },

  /**
   * Lease a claimed row before sending: a conditional UPDATE that only wins
   * while the row is still pending and due. Overlapping relays (cron sweep,
   * engine post-execution sweep) therefore send each row at most once per
   * lease window. A crashed relay's lease expires and the row becomes due
   * again. Mock drivers without RETURNING are treated as leased.
   */
  async lease(db: Database, eventId: string, leaseUntil: string): Promise<boolean> {
    const updateFn = (db as unknown as { update?: unknown }).update
    if (typeof updateFn !== 'function') return true
    const now = new Date().toISOString()
    const chain = (
      updateFn as (table: typeof webhookOutbox) => {
        set: (values: Record<string, unknown>) => unknown
      }
    ).call(db, webhookOutbox).set({ nextAttemptAt: leaseUntil }) as unknown as {
      where?: (cond: unknown) => unknown
    }
    if (!chain || typeof chain.where !== 'function') return true
    const filtered = chain.where(
      and(
        eq(webhookOutbox.eventId, eventId),
        eq(webhookOutbox.status, 'pending'),
        or(isNull(webhookOutbox.nextAttemptAt), lte(webhookOutbox.nextAttemptAt, now))
      )
    ) as { returning?: (fields: unknown) => PromiseLike<unknown[]> } & PromiseLike<unknown>
    if (filtered && typeof filtered.returning === 'function') {
      const rows = await filtered.returning({ eventId: webhookOutbox.eventId })
      return Array.isArray(rows) && rows.length > 0
    }
    await filtered
    return true
  },
}

function dueConditions(staleOnlyMs?: number) {
  const now = new Date().toISOString()
  const conditions = [
    eq(webhookOutbox.status, 'pending'),
    or(isNull(webhookOutbox.nextAttemptAt), lte(webhookOutbox.nextAttemptAt, now)),
  ]
  if (staleOnlyMs && staleOnlyMs > 0) {
    conditions.push(lte(webhookOutbox.createdAt, new Date(Date.now() - staleOnlyMs).toISOString()))
  }
  return conditions
}

async function applyOutboxUpdate(
  db: Database,
  eventId: string,
  patch: { status: string; nextAttemptAt: string | null }
): Promise<void> {
  const updateFn = (db as unknown as { update?: unknown }).update
  if (typeof updateFn !== 'function') {
    logger.warn('webhook_outbox_update_unsupported', { eventId })
    return
  }
  const chain = (
    updateFn as (table: typeof webhookOutbox) => {
      set: (values: Record<string, unknown>) => unknown
    }
  ).call(db, webhookOutbox).set({
    ...patch,
    attempts: sql`${webhookOutbox.attempts} + 1`,
  }) as unknown as {
    where?: (cond: unknown) => Promise<unknown> | unknown
    run?: () => Promise<unknown>
  } & PromiseLike<unknown>
  if (chain && typeof chain.where === 'function') {
    await chain.where(eq(webhookOutbox.eventId, eventId))
    return
  }
  if (chain && typeof (chain as { run?: unknown }).run === 'function') {
    await (chain as { run: () => Promise<unknown> }).run()
    return
  }
  await chain
}
