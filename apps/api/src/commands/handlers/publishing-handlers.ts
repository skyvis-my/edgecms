import { entriesService } from '@/entries/entries.service'
import { ragService } from '@/ai/rag.service'
import { validateTransition } from '@/scheduling/lifecycle.service'
import type { CommandHandler } from '../engine'

/**
 * Handle publishNow command.
 *
 * Updates an entry's status to 'published', recording the state transition
 * in the audit log.
 */
export const handlePublishNow: CommandHandler = async (ctx, payload) => {
  const { entryId } = payload as { entryId: string }

  // Fetch current entry to validate lifecycle transition
  const entryResult = await entriesService.findById(ctx.db, entryId, ctx.tenantScope)
  if (!entryResult.success) {
    return { success: false, error: entryResult.error }
  }

  const currentStatus = entryResult.data.status

  // Validate lifecycle transition to 'published'
  const transition = validateTransition(currentStatus, 'published')
  if (!transition.valid) {
    return { success: false, error: { code: 'INVALID_TRANSITION', message: transition.error } }
  }

  // Capture before-state for webhook events
  const before = entryResult.data as unknown as Record<string, unknown>

  const result = await entriesService.update(
    ctx.db,
    entryId,
    { status: 'published' },
    ctx.actor.userId,
    undefined,
    ctx.tenantScope
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  // Non-blocking content RAG embedding indexing
  void ragService.indexPublishedEntry(ctx.db, ctx.env, entryId, ctx.tenantScope)

  return {
    success: true,
    data: result.data as unknown as Record<string, unknown>,
    before,
    auditEntries: [
      {
        entityType: 'entry',
        entityId: entryId,
        action: 'publish',
        changes: { status: 'published' },
      },
    ],
  }
}

/**
 * Handle unpublishNow command.
 *
 * Updates an entry's status to 'draft', recording the state transition
 * in the audit log.
 */
export const handleUnpublishNow: CommandHandler = async (ctx, payload) => {
  const { entryId } = payload as { entryId: string }

  // Fetch current entry to validate lifecycle transition
  const entryResult = await entriesService.findById(ctx.db, entryId, ctx.tenantScope)
  if (!entryResult.success) {
    return { success: false, error: entryResult.error }
  }

  const currentStatus = entryResult.data.status

  // Validate lifecycle transition to 'draft'
  const transition = validateTransition(currentStatus, 'draft')
  if (!transition.valid) {
    return { success: false, error: { code: 'INVALID_TRANSITION', message: transition.error } }
  }

  // Capture before-state for webhook events
  const before = entryResult.data as unknown as Record<string, unknown>

  const result = await entriesService.update(
    ctx.db,
    entryId,
    { status: 'draft' },
    ctx.actor.userId,
    undefined,
    ctx.tenantScope
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  return {
    success: true,
    data: result.data as unknown as Record<string, unknown>,
    before,
    auditEntries: [
      {
        entityType: 'entry',
        entityId: entryId,
        action: 'unpublish',
        changes: { status: 'draft' },
      },
    ],
  }
}
