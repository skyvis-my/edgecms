import { collectionsRepository } from '@/collections/collections.repository'
import { entriesService } from '@/entries/entries.service'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { validateTransition } from '@/scheduling/lifecycle.service'
import { cancelSchedule as cancelScheduleDO, notifySchedule } from '@/scheduling/scheduler.service'
import type { CommandHandler } from '../engine'

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

  // Notify DO scheduler (non-blocking — failures are logged but don't fail the command)
  try {
    if (ctx.env) {
      await notifySchedule(ctx.env as unknown as Env, entryId, 'publish', publishAt, {
        collectionSlug: collection?.slug,
        locales: collection?.supportedLocales,
        tenantScope: ctx.tenantScope,
      })
    }
  } catch (err) {
    logger.error('scheduler_notification_failed', { error: err instanceof Error ? err.message : String(err) })
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

  // Notify DO scheduler
  try {
    if (ctx.env) {
      await notifySchedule(ctx.env as unknown as Env, entryId, 'unpublish', unpublishAt, {
        collectionSlug: collection?.slug,
        locales: collection?.supportedLocales,
        tenantScope: ctx.tenantScope,
      })
    }
  } catch (err) {
    logger.error('scheduler_notification_failed', { error: err instanceof Error ? err.message : String(err) })
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

  // Cancel in DO scheduler
  try {
    if (ctx.env) {
      await cancelScheduleDO(ctx.env as unknown as Env, entryId, 'publish')
      await cancelScheduleDO(ctx.env as unknown as Env, entryId, 'unpublish')
    }
  } catch (err) {
    logger.error('scheduler_notification_failed', { error: err instanceof Error ? err.message : String(err) })
  }

  return {
    success: true,
    data: result.data as unknown as Record<string, unknown>,
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
