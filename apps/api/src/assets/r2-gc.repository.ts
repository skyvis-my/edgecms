import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { r2GcOutbox } from '@/database/schema/assets.schema'
import { logger } from '@/observability/logger'

/** Row type inferred from the r2_gc_outbox table. */
export type R2GcRow = typeof r2GcOutbox.$inferSelect

export const R2_GC_RETRY_DELAY_MS = 5 * 60 * 1000

function backoffIso(): string {
  return new Date(Date.now() + R2_GC_RETRY_DELAY_MS).toISOString()
}

/**
 * Durable R2-delete outbox repository + sweeper.
 *
 * All methods degrade gracefully on mock drivers without full query chains
 * (capability probes + safe fallbacks), following the webhook outbox pattern.
 */
export const r2GcRepository = {
  /**
   * Enqueue object keys for guaranteed deletion. Double-enqueue of the same
   * key collapses via UNIQUE(object_key). Returns false when the driver
   * cannot persist (caller falls back to direct best-effort deletes).
   */
  async enqueueKeys(db: Database, tenantId: string, keys: string[]): Promise<boolean> {
    const uniqueKeys = [...new Set(keys)].filter((k) => k.length > 0)
    if (uniqueKeys.length === 0) return true
    if (typeof (db as unknown as { insert?: unknown }).insert !== 'function') return false
    const now = new Date().toISOString()
    const rows = uniqueKeys.map((objectKey) => ({
      id: crypto.randomUUID(),
      tenantId,
      objectKey,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null as string | null,
      createdAt: now,
    }))
    try {
      const insert = db.insert(r2GcOutbox) as unknown as {
        values?: (rows: unknown) => unknown
        onConflictDoNothing?: (args: unknown) => Promise<unknown>
      } & PromiseLike<unknown>
      if (typeof insert?.values !== 'function') return false
      const pending = insert.values(rows) as unknown as {
        onConflictDoNothing?: (args: unknown) => Promise<unknown>
      } & PromiseLike<unknown>
      if (pending && typeof pending.onConflictDoNothing === 'function') {
        await pending.onConflictDoNothing({ target: r2GcOutbox.objectKey })
        return true
      }
      await pending
      return true
    } catch (err) {
      // Concurrent enqueue of the same key is benign; anything else fails open
      // (caller still attempts the direct delete) but is logged.
      if (err instanceof Error && /unique|SQLITE_CONSTRAINT/i.test(err.message)) return true
      logger.warn('r2_gc_enqueue_failed', {
        tenantId,
        count: uniqueKeys.length,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  },

  /** Claim up to `limit` due pending rows, oldest first. */
  async claimPending(db: Database, limit = 50): Promise<R2GcRow[]> {
    if (typeof (db as unknown as { select?: unknown }).select !== 'function') return []
    const now = new Date().toISOString()
    const chain = db
      .select()
      .from(r2GcOutbox)
      .where(
        and(
          eq(r2GcOutbox.status, 'pending'),
          or(isNull(r2GcOutbox.nextAttemptAt), lte(r2GcOutbox.nextAttemptAt, now))
        )
      ) as unknown as {
      orderBy?: (order: unknown) => unknown
      limit?: (n: number) => unknown
      all?: () => Promise<R2GcRow[]>
    } & PromiseLike<R2GcRow[]>
    if (!chain) return []
    if (typeof chain.orderBy === 'function') {
      const ordered = chain.orderBy(asc(r2GcOutbox.createdAt)) as unknown as {
        limit?: (n: number) => unknown
        all?: () => Promise<R2GcRow[]>
      } & PromiseLike<R2GcRow[]>
      if (typeof ordered.limit === 'function') {
        const limited = ordered.limit(limit) as unknown as {
          all?: () => Promise<R2GcRow[]>
        } & PromiseLike<R2GcRow[]>
        if (typeof limited.all === 'function') return limited.all()
        return (await limited) as R2GcRow[]
      }
      if (typeof ordered.all === 'function') return (await ordered.all()).slice(0, limit)
      return ((await ordered) as R2GcRow[]).slice(0, limit)
    }
    if (typeof chain.all === 'function') return (await chain.all()).slice(0, limit)
    return ((await chain) as R2GcRow[]).slice(0, limit)
  },

  /** Mark a key deleted after successful r2.delete. */
  async markSentByKey(db: Database, objectKey: string): Promise<void> {
    await applyGcUpdate(db, objectKey, { status: 'sent', nextAttemptAt: null })
  },

  /** Leave a key pending with a +5min backoff after a failed r2.delete. */
  async markFailedByKey(db: Database, objectKey: string): Promise<void> {
    await applyGcUpdate(db, objectKey, { status: 'pending', nextAttemptAt: backoffIso() })
  },
}

async function applyGcUpdate(
  db: Database,
  objectKey: string,
  patch: { status: string; nextAttemptAt: string | null }
): Promise<void> {
  const updateFn = (db as unknown as { update?: unknown }).update
  if (typeof updateFn !== 'function') {
    logger.warn('r2_gc_update_unsupported', { objectKey })
    return
  }
  try {
    const chain = (
      updateFn as (table: typeof r2GcOutbox) => {
        set: (values: Record<string, unknown>) => unknown
      }
    )(r2GcOutbox).set({
      ...patch,
      attempts: sql`${r2GcOutbox.attempts} + 1`,
    }) as unknown as {
      where?: (cond: unknown) => Promise<unknown> | unknown
      run?: () => Promise<unknown>
    } & PromiseLike<unknown>
    if (chain && typeof chain.where === 'function') {
      await chain.where(eq(r2GcOutbox.objectKey, objectKey))
      return
    }
    if (chain && typeof (chain as { run?: unknown }).run === 'function') {
      await (chain as { run: () => Promise<unknown> }).run()
      return
    }
    await chain
  } catch (err) {
    logger.warn('r2_gc_update_failed', {
      objectKey,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Sweep pending R2 deletes: claim due rows, r2.delete each (idempotent),
 * mark sent/failed. Returns counts. Never throws (r2 client errors are
 * per-key failures).
 */
export async function sweepR2GcOutbox(
  db: Database,
  r2: Pick<R2Bucket, 'delete'>,
  opts: { limit?: number } = {}
): Promise<{ deleted: number; failed: number }> {
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 50) || 50))
  let rows: R2GcRow[]
  try {
    rows = await r2GcRepository.claimPending(db, limit)
  } catch (err) {
    logger.warn('r2_gc_claim_failed', { error: err instanceof Error ? err.message : String(err) })
    return { deleted: 0, failed: 0 }
  }
  if (rows.length === 0) return { deleted: 0, failed: 0 }
  const outcomes = await Promise.allSettled(
    rows.map(async (row) => {
      await r2.delete(row.objectKey)
      await r2GcRepository.markSentByKey(db, row.objectKey)
    })
  )
  let deleted = 0
  for (let i = 0; i < outcomes.length; i++) {
    if (outcomes[i]?.status === 'fulfilled') {
      deleted++
    } else {
      await r2GcRepository.markFailedByKey(db, rows[i]!.objectKey)
    }
  }
  const failed = outcomes.length - deleted
  if (failed > 0) {
    logger.warn('r2_gc_sweep_failed', { failed, claimed: rows.length })
  }
  return { deleted, failed }
}
