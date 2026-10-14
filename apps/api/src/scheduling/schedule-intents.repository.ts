import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { scheduleIntents } from '@/database/schema/scheduling.schema'
import { entriesRepository } from '@/entries/entries.repository'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { cancelSchedule as cancelScheduleDO, notifySchedule } from './scheduler.service'

/** Row type inferred from the schedule_intents table. */
export type ScheduleIntentRow = typeof scheduleIntents.$inferSelect

export type ScheduleTransitionType = 'publish' | 'unpublish'
export type ScheduleIntentStatus = 'pending' | 'cancelled' | 'done'

export const SCHEDULE_INTENT_RETRY_DELAY_MS = 5 * 60 * 1000

function backoffIso(): string {
  return new Date(Date.now() + SCHEDULE_INTENT_RETRY_DELAY_MS).toISOString()
}

function hasInsert(db: Database): boolean {
  return typeof (db as unknown as { insert?: unknown }).insert === 'function'
}

function hasSelect(db: Database): boolean {
  return typeof (db as unknown as { select?: unknown }).select === 'function'
}

function hasUpdate(db: Database): boolean {
  return typeof (db as unknown as { update?: unknown }).update === 'function'
}

/**
 * Durable schedule-intent repository + sweeper.
 *
 * Intent writes are best-effort side effects of the schedule/cancel command
 * handlers (they must never fail the command): every method degrades to a
 * safe no-op on drivers without full query chains.
 */
export const scheduleIntentsRepository = {
  /**
   * Record (or overwrite) the intent for an (entry, transition). Overwrite
   * semantics keep the sweeper from acting on superseded timestamps.
   */
  async upsertIntent(
    db: Database,
    input: {
      entryId: string
      transitionType: ScheduleTransitionType
      scheduledAt: string | null
      tenantScope?: string
      status: Extract<ScheduleIntentStatus, 'pending' | 'cancelled'>
    }
  ): Promise<void> {
    try {
      if (!hasUpdate(db) && !hasInsert(db)) return
      const now = new Date().toISOString()
      const scope = input.tenantScope ?? 'global'
      if (hasUpdate(db)) {
        const updated = await db
          .update(scheduleIntents)
          .set({
            scheduledAt: input.scheduledAt,
            tenantScope: scope,
            status: input.status,
            nextAttemptAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(scheduleIntents.entryId, input.entryId),
              eq(scheduleIntents.transitionType, input.transitionType)
            )
          )
          .returning({ id: scheduleIntents.id })
          .catch(() => [] as Array<{ id: string }>)
        if (updated.length > 0) return
      }
      if (!hasInsert(db)) return
      const builder = db.insert(scheduleIntents).values({
        id: crypto.randomUUID(),
        entryId: input.entryId,
        transitionType: input.transitionType,
        scheduledAt: input.scheduledAt,
        tenantScope: scope,
        status: input.status,
        attempts: 0,
        nextAttemptAt: null,
        createdAt: now,
        updatedAt: now,
      }) as unknown as {
        onConflictDoUpdate?: (args: unknown) => Promise<unknown>
      } & PromiseLike<unknown>
      if (builder && typeof builder.onConflictDoUpdate === 'function') {
        await builder.onConflictDoUpdate({
          target: [scheduleIntents.entryId, scheduleIntents.transitionType],
          set: {
            scheduledAt: input.scheduledAt,
            tenantScope: scope,
            status: input.status,
            nextAttemptAt: null,
            updatedAt: now,
          },
        })
        return
      }
      await builder
    } catch (err) {
      // UNIQUE race (concurrent upsert won) is benign; anything else is logged
      // but never fails the calling command.
      if (err instanceof Error && /unique|SQLITE_CONSTRAINT/i.test(err.message)) return
      logger.error('schedule_intent_write_failed', {
        entryId: input.entryId,
        transitionType: input.transitionType,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  /** Mark an intent reconciled. */
  async markDone(db: Database, entryId: string, transitionType: ScheduleTransitionType): Promise<void> {
    await applyIntentUpdate(db, entryId, transitionType, { status: 'done', nextAttemptAt: null })
  },

  /** Leave an intent open with a backoff after a failed DO call. */
  async markFailed(db: Database, entryId: string, transitionType: ScheduleTransitionType): Promise<void> {
    await applyIntentUpdate(db, entryId, transitionType, {
      status: undefined,
      nextAttemptAt: backoffIso(),
    })
  },

  /** Claim due open intents (pending + cancelled), oldest first. */
  async claimPending(db: Database, limit = 20): Promise<ScheduleIntentRow[]> {
    if (!hasSelect(db)) return []
    const now = new Date().toISOString()
    const chain = db
      .select()
      .from(scheduleIntents)
      .where(
        and(
          inArray(scheduleIntents.status, ['pending', 'cancelled']),
          or(isNull(scheduleIntents.nextAttemptAt), lte(scheduleIntents.nextAttemptAt, now))
        )
      ) as unknown as {
      orderBy?: (order: unknown) => unknown
      limit?: (n: number) => unknown
      all?: () => Promise<ScheduleIntentRow[]>
    } & PromiseLike<ScheduleIntentRow[]>
    if (!chain) return []
    if (typeof chain.orderBy === 'function') {
      const ordered = chain.orderBy(asc(scheduleIntents.createdAt)) as unknown as {
        limit?: (n: number) => unknown
        all?: () => Promise<ScheduleIntentRow[]>
      } & PromiseLike<ScheduleIntentRow[]>
      if (typeof ordered.limit === 'function') {
        const limited = ordered.limit(limit) as unknown as {
          all?: () => Promise<ScheduleIntentRow[]>
        } & PromiseLike<ScheduleIntentRow[]>
        if (typeof limited.all === 'function') return limited.all()
        return (await limited) as ScheduleIntentRow[]
      }
      if (typeof ordered.all === 'function') return (await ordered.all()).slice(0, limit)
      return ((await ordered) as ScheduleIntentRow[]).slice(0, limit)
    }
    if (typeof chain.all === 'function') return (await chain.all()).slice(0, limit)
    return ((await chain) as ScheduleIntentRow[]).slice(0, limit)
  },
}

async function applyIntentUpdate(
  db: Database,
  entryId: string,
  transitionType: ScheduleTransitionType,
  patch: { status?: string; nextAttemptAt: string | null }
): Promise<void> {
  if (!hasUpdate(db)) return
  try {
    const setValues: Record<string, unknown> = {
      attempts: sql`${scheduleIntents.attempts} + 1`,
      updatedAt: new Date().toISOString(),
      nextAttemptAt: patch.nextAttemptAt,
    }
    if (patch.status !== undefined) setValues.status = patch.status
    const chain = (
      (db as unknown as { update: (table: typeof scheduleIntents) => {
        set: (values: Record<string, unknown>) => unknown
      } }).update
    )(scheduleIntents).set(setValues) as unknown as {
      where?: (cond: unknown) => Promise<unknown> | unknown
      run?: () => Promise<unknown>
    } & PromiseLike<unknown>
    const condition = and(
      eq(scheduleIntents.entryId, entryId),
      eq(scheduleIntents.transitionType, transitionType)
    )
    if (chain && typeof chain.where === 'function') {
      await chain.where(condition)
      return
    }
    if (chain && typeof (chain as { run?: unknown }).run === 'function') {
      await (chain as { run: () => Promise<unknown> }).run()
      return
    }
    await chain
  } catch (err) {
    logger.error('schedule_intent_update_failed', {
      entryId,
      transitionType,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export type ScheduleSweepResult = {
  claimed: number
  notified: number
  cancelled: number
  stale: number
  failed: number
}

/**
 * Reconcile open schedule intents against entry timestamps and the DO queue.
 *
 * - cancelled → re-issue the DO cancel (idempotent), then done.
 * - pending/publish → re-notify only if the entry is still scheduled with
 *   the same publishAt; otherwise done (stale).
 * - pending/unpublish → re-notify only if unpublishAt still matches.
 * - missing entry → done (stale).
 * DO failures keep the intent open with a backoff. Never throws.
 */
export async function sweepScheduleIntents(
  db: Database,
  env: Env,
  opts: { limit?: number } = {}
): Promise<ScheduleSweepResult> {
  const result: ScheduleSweepResult = { claimed: 0, notified: 0, cancelled: 0, stale: 0, failed: 0 }
  if (!env || typeof (env as unknown as { PUBLISH_SCHEDULER?: unknown }).PUBLISH_SCHEDULER === 'undefined') {
    logger.error('schedule_sweep_missing_binding', {})
    return result
  }
  const limit = Math.min(50, Math.max(1, Math.floor(opts.limit ?? 20) || 20))
  let intents: ScheduleIntentRow[]
  try {
    intents = await scheduleIntentsRepository.claimPending(db, limit)
  } catch (err) {
    logger.error('schedule_sweep_claim_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return result
  }
  result.claimed = intents.length

  for (const intent of intents) {
    const transition = intent.transitionType as ScheduleTransitionType
    try {
      if (intent.status === 'cancelled') {
        await cancelScheduleDO(env, intent.entryId, 'publish')
        await cancelScheduleDO(env, intent.entryId, 'unpublish')
        await scheduleIntentsRepository.markDone(db, intent.entryId, transition)
        result.cancelled++
        continue
      }
      const entry = await entriesRepository.findById(db, intent.entryId, intent.tenantScope)
      if (!entry) {
        await scheduleIntentsRepository.markDone(db, intent.entryId, transition)
        result.stale++
        continue
      }
      const liveTimestamp =
        transition === 'publish'
          ? entry.status === 'scheduled'
            ? entry.publishAt
            : null
          : entry.unpublishAt
      if (liveTimestamp !== intent.scheduledAt) {
        // Rescheduled, cancelled, or fired elsewhere — intent superseded.
        await scheduleIntentsRepository.markDone(db, intent.entryId, transition)
        result.stale++
        continue
      }
      await notifySchedule(env, intent.entryId, transition, intent.scheduledAt as string, {
        tenantScope: intent.tenantScope,
      })
      await scheduleIntentsRepository.markDone(db, intent.entryId, transition)
      result.notified++
    } catch (err) {
      logger.error('schedule_sweep_intent_failed', {
        entryId: intent.entryId,
        transitionType: intent.transitionType,
        error: err instanceof Error ? err.message : String(err),
        retryable: true,
      })
      await scheduleIntentsRepository.markFailed(db, intent.entryId, transition)
      result.failed++
    }
  }
  return result
}
