import { collectionsRepository } from '@/collections/collections.repository'
import { entriesService } from '@/entries/entries.service'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { validateTransition } from '@/scheduling/lifecycle.service'
import { cancelSchedule as cancelScheduleDO, notifySchedule } from '@/scheduling/scheduler.service'
import { scheduleIntentsRepository } from '@/scheduling/schedule-intents.repository'
import { getDeferredWorkScheduler } from '../deferred-work'
import type { CommandHandler } from '../engine'

/**
 * Notify the DO scheduler without adding tail latency when `waitUntil` is
 * available. Falls back to awaiting. Either way errors are isolated: the DB
 * update above is already committed, so a notify failure only logs (the entry
 * keeps its timestamps and a retry still converges).
 */
function scheduleOrAwaitSchedulerNotify(
  ctx: Parameters<CommandHandler>[0],
  attempt: Promise<void>,
  meta: { retryable?: boolean; entryId: string }
): Promise<void> {
  const guarded = attempt.catch((err: unknown) => {
    logger.error('scheduler_notification_failed', {
      ...meta,
      error: err instanceof Error ? err.message : String(err),
    })
  })
  const scheduler = getDeferredWorkScheduler(ctx)
  if (scheduler) {
    try {
      scheduler(guarded)
      return Promise.resolve()
    } catch (err) {
      logger.error('scheduler_notification_failed', {
        ...meta,
        error: err instanceof Error ? err.message : String(err),
      })
      return Promise.resolve()
    }
  }
  return guarded
}

/**
 * Handle schedulePublish command.
 * Validates lifecycle transition, sets publishAt timestamp, transitions to 'scheduled' status,
 * and notifies the Durable Object scheduler.
 */
export const handleSchedulePublish: CommandHandler = async (ctx, payload) => {
  const { entryId, publishAt } = payload as { entryId: string; publishAt: string }

  // Fetch current entry
  const entryResult = await entriesService.findById(ctx.db, entryId, ctx.tenantScope)
  if (!entryResult.success) {
    return { success: false, error: entryResult.error }
  }

  const currentStatus = entryResult.data.status
  const collection = await collectionsRepository.findById(
    ctx.db,
    entryResult.data.collectionId,
    ctx.tenantScope
  )

  // Validate lifecycle transition (draft -> scheduled)
  const transition = validateTransition(currentStatus, 'scheduled')
  if (!transition.valid) {
    return { success: false, error: { code: 'INVALID_TRANSITION', message: transition.error } }
  }

  // Capture before-state for webhook events
  const before = entryResult.data as unknown as Record<string, unknown>

  // Update entry: set status to 'scheduled' and publishAt timestamp
  const result = await entriesService.update(
    ctx.db,
    entryId,
    { status: 'scheduled', publishAt },
    ctx.actor.userId,
    undefined,
    ctx.tenantScope
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  // Durable intent first: if the DO notify below is lost, the sweeper
  // re-notifies from this row (see sweepScheduleIntents).
  await scheduleIntentsRepository.upsertIntent(ctx.db, {
    entryId,
    transitionType: 'publish',
    scheduledAt: publishAt,
    tenantScope: ctx.tenantScope,
    status: 'pending',
  })
  // Notify DO scheduler (non-blocking — failures are logged but don't fail the command)
  // Outbox note: the DB update above is already committed; the DO notify is a
  // best-effort side effect. On notify failure the entry keeps status
  // 'scheduled' with its publishAt/unpublishAt timestamp, so a retry (or the
  // TTL-bounded cache expiry) still converges — never silently mark failed.
  // Deferred via `waitUntil` when available so a slow DO never delays the response.
  if (ctx.env) {
    await scheduleOrAwaitSchedulerNotify(
      ctx,
      (async () => {
        await notifySchedule(ctx.env as unknown as Env, entryId, 'publish', publishAt, {
          collectionSlug: collection?.slug,
          locales: collection?.supportedLocales,
          tenantScope: ctx.tenantScope,
        })
        await scheduleIntentsRepository.markDone(ctx.db, entryId, 'publish')
      })(),
      { retryable: true, entryId }
    )
  }

  return {
    success: true,
    data: result.data as unknown as Record<string, unknown>,
    before,
    auditEntries: [
      {
        entityType: 'entry',
        entityId: entryId,
        action: 'schedulePublish',
        changes: { status: 'scheduled', publishAt },
      },
    ],
  }
}

/**
 * Handle scheduleUnpublish command.
 * Sets unpublishAt timestamp on a published entry and notifies the DO scheduler.
 * Entry stays 'published' — unpublish occurs when the alarm fires.
 */
export const handleScheduleUnpublish: CommandHandler = async (ctx, payload) => {
  const { entryId, unpublishAt } = payload as { entryId: string; unpublishAt: string }

  // Fetch current entry
  const entryResult = await entriesService.findById(ctx.db, entryId, ctx.tenantScope)
  if (!entryResult.success) {
    return { success: false, error: entryResult.error }
  }

  const currentStatus = entryResult.data.status
  const collection = await collectionsRepository.findById(
    ctx.db,
    entryResult.data.collectionId,
    ctx.tenantScope
  )

  // Only published entries can schedule unpublish
  if (currentStatus !== 'published') {
    return {
      success: false,
      error: {
        code: 'INVALID_TRANSITION',
        message: `Can only schedule unpublish for published entries, current status: '${currentStatus}'`,
      },
    }
  }

  // Capture before-state for webhook events
  const before = entryResult.data as unknown as Record<string, unknown>

  // Update entry: set unpublishAt timestamp (status stays 'published')
  const result = await entriesService.update(
    ctx.db,
    entryId,
    { unpublishAt },
    ctx.actor.userId,
    undefined,
    ctx.tenantScope
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  // Durable intent first (see handleSchedulePublish).
  await scheduleIntentsRepository.upsertIntent(ctx.db, {
    entryId,
    transitionType: 'unpublish',
    scheduledAt: unpublishAt,
    tenantScope: ctx.tenantScope,
    status: 'pending',
  })
  // Outbox note: DB update committed; DO notify best-effort, entry keeps its timestamps on failure (retryable).
  // Deferred via `waitUntil` when available so a slow DO never delays the response.
  if (ctx.env) {
    await scheduleOrAwaitSchedulerNotify(
      ctx,
      (async () => {
        await notifySchedule(ctx.env as unknown as Env, entryId, 'unpublish', unpublishAt, {
          collectionSlug: collection?.slug,
          locales: collection?.supportedLocales,
          tenantScope: ctx.tenantScope,
        })
        await scheduleIntentsRepository.markDone(ctx.db, entryId, 'unpublish')
      })(),
      { entryId }
    )
  }

  return {
    success: true,
    data: result.data as unknown as Record<string, unknown>,
    before,
    auditEntries: [
      {
        entityType: 'entry',
        entityId: entryId,
        action: 'scheduleUnpublish',
        changes: { unpublishAt },
      },
    ],
  }
}

/**
 * Handle cancelSchedule command.
 * Clears publishAt/unpublishAt timestamps and transitions scheduled entries back to draft.
 */
export const handleCancelSchedule: CommandHandler = async (ctx, payload) => {
  const { entryId } = payload as { entryId: string }

  // Fetch current entry
  const entryResult = await entriesService.findById(ctx.db, entryId, ctx.tenantScope)
  if (!entryResult.success) {
    return { success: false, error: entryResult.error }
  }

  const currentStatus = entryResult.data.status

  // Capture before-state for webhook events
  const before = entryResult.data as unknown as Record<string, unknown>

  // Determine new status and what to clear
  const updates: Record<string, unknown> = { publishAt: null, unpublishAt: null }

  if (currentStatus === 'scheduled') {
    // Validate transition back to draft
    const transition = validateTransition(currentStatus, 'draft')
    if (!transition.valid) {
      return { success: false, error: { code: 'INVALID_TRANSITION', message: transition.error } }
    }
    updates.status = 'draft'
  }
  // For published entries with unpublishAt, just clear the unpublishAt (status stays published)

  const result = await entriesService.update(
    ctx.db,
    entryId,
    updates,
    ctx.actor.userId,
    undefined,
    ctx.tenantScope
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  // Durable cancel intents first: if the DO cancel below is lost, the
  // sweeper re-issues it (prevents phantom publish after cancel).
  await scheduleIntentsRepository.upsertIntent(ctx.db, {
    entryId,
    transitionType: 'publish',
    scheduledAt: null,
    tenantScope: ctx.tenantScope,
    status: 'cancelled',
  })
  await scheduleIntentsRepository.upsertIntent(ctx.db, {
    entryId,
    transitionType: 'unpublish',
    scheduledAt: null,
    tenantScope: ctx.tenantScope,
    status: 'cancelled',
  })
  // Outbox note: DB update committed; DO cancel best-effort with retry flag on failure.
  // Fence: surface schedulerSyncRequired so callers/sweepers reconcile publishAt vs DO queue
  // (prevents phantom publish after cancel when the DO call is lost).
  let schedulerSyncRequired = false
  try {
    if (ctx.env) {
      await cancelScheduleDO(ctx.env as unknown as Env, entryId, 'publish')
      await cancelScheduleDO(ctx.env as unknown as Env, entryId, 'unpublish')
      // Only done when the DO confirms: without env there is nothing to
      // confirm against, so the intents stay open for the sweeper.
      await scheduleIntentsRepository.markDone(ctx.db, entryId, 'publish')
      await scheduleIntentsRepository.markDone(ctx.db, entryId, 'unpublish')
    }
  } catch (err) {
    schedulerSyncRequired = true
    logger.error('scheduler_cancel_failed_sync_required', {
      error: err instanceof Error ? err.message : String(err),
      entryId,
      retryable: true,
    })
  }

  return {
    success: true,
    data: {
      ...(result.data as unknown as Record<string, unknown>),
      // Only present when the DO cancel was lost (sweeper must reconcile).
      ...(schedulerSyncRequired ? { schedulerSyncRequired: true as const } : {}),
    },
    before,
    auditEntries: [
      {
        entityType: 'entry',
        entityId: entryId,
        action: 'cancelSchedule',
        changes: updates,
      },
    ],
  }
}
