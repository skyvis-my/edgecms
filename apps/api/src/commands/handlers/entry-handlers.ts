import { entriesService } from '@/entries/entries.service'
import type { CommandHandler } from '../engine'
import { isCommandLifecycleStatus } from '@/shared/schemas/entry'

function lifecycleCommandError(targetStatus: string, beforeStatus?: string) {
  const command =
    targetStatus === 'scheduled'
      ? 'schedulePublish'
      : targetStatus === 'published'
        ? 'publishNow'
        : beforeStatus === 'scheduled'
          ? 'cancelSchedule'
          : 'unpublishNow'
  return {
    code: 'INVALID_STATUS_TRANSITION',
    message: `Use ${command} for ${targetStatus} lifecycle changes.`,
  }
}

function isBlockedLifecycleStatusChange(targetStatus: string, beforeStatus: string): boolean {
  return (
    targetStatus !== beforeStatus &&
    (isCommandLifecycleStatus(targetStatus) || isCommandLifecycleStatus(beforeStatus))
  )
}

/**
 * Handle createEntry command.
 *
 * Delegates to the entries service to create a new entry,
 * producing an audit entry for the creation.
 */
export const handleCreateEntry: CommandHandler = async (ctx, payload) => {
  const { collectionId, slug, status, data } = payload as {
    collectionId: string
    slug?: string
    status?: string
    data: Record<string, unknown>
  }

  if (status !== undefined && isCommandLifecycleStatus(status)) {
    return { success: false, error: lifecycleCommandError(status) }
  }

  const result = await entriesService.create(
    ctx.db,
    { collectionId, slug, status, data },
    ctx.actor.userId,
    ctx.tenantScope
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  return {
    success: true,
    data: result.data as unknown as Record<string, unknown>,
    auditEntries: [
      {
        entityType: 'entry',
        entityId: result.data.id,
        action: 'create',
        changes: result.data as unknown as Record<string, unknown>,
      },
    ],
  }
}

/**
 * Handle updateEntry command.
 *
 * Supports optimistic concurrency via version checking.
 * Emits the full updated row in audit changes for sync pull upsert semantics.
 */
export const handleUpdateEntry: CommandHandler = async (ctx, payload, optimisticVersion) => {
  const { entryId, slug, status, data } = payload as {
    entryId: string
    slug?: string
    status?: string
    data?: Record<string, unknown>
  }

  // Capture before-state for webhook events
  const beforeResult = await entriesService.findById(ctx.db, entryId, ctx.tenantScope)
  const before = beforeResult.success
    ? (beforeResult.data as unknown as Record<string, unknown>)
    : null

  if (status !== undefined) {
    if (!beforeResult.success) {
      return { success: false, error: beforeResult.error }
    }

    const beforeStatus = String(beforeResult.data.status)
    if (isBlockedLifecycleStatusChange(status, beforeStatus)) {
      return { success: false, error: lifecycleCommandError(status, beforeStatus) }
    }
  }

  const result = await entriesService.update(
    ctx.db,
    entryId,
    { slug, status, data },
    ctx.actor.userId,
    optimisticVersion,
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
        action: 'update',
        // Sync pull consumers require a full entry row for upsert semantics.
        changes: result.data as unknown as Record<string, unknown>,
      },
    ],
  }
}

/**
 * Handle deleteEntry command.
 *
 * Delegates to the entries service to soft/hard delete.
 */
export const handleDeleteEntry: CommandHandler = async (ctx, payload) => {
  const { entryId } = payload as { entryId: string }

  const result = await entriesService.deleteById(ctx.db, entryId, ctx.tenantScope)

  if (!result.success) {
    return { success: false, error: result.error }
  }

  return {
    success: true,
    data: result.data as unknown as Record<string, unknown>,
    auditEntries: [
      {
        entityType: 'entry',
        entityId: entryId,
        action: 'delete',
      },
    ],
  }
}

/**
 * Handle bulkUpdate command.
 *
 * Iterates over entry IDs and applies the same updates to each.
 * Produces one audit entry per updated entry.
 */
export const handleBulkUpdate: CommandHandler = async (ctx, payload) => {
  const { entryIds, updates } = payload as {
    entryIds: string[]
    updates: { status?: string; data?: Record<string, unknown> }
  }

  const results: Record<string, unknown>[] = []
  const auditEntries: Array<{
    entityType: string
    entityId: string
    action: string
    changes?: Record<string, unknown>
  }> = []
  const errors: Array<{ entryId: string; error: { code: string; message: string } }> = []

  if (updates.status !== undefined) {
    for (const entryId of entryIds) {
      const beforeResult = await entriesService.findById(ctx.db, entryId, ctx.tenantScope)
      if (!beforeResult.success) {
        return { success: false, error: beforeResult.error }
      }

      const beforeStatus = String(beforeResult.data.status)
      if (isBlockedLifecycleStatusChange(updates.status, beforeStatus)) {
        return {
          success: false,
          error: lifecycleCommandError(updates.status, beforeStatus),
        }
      }
    }
  }

  for (const entryId of entryIds) {
    const result = await entriesService.update(
      ctx.db,
      entryId,
      updates,
      ctx.actor.userId,
      undefined,
      ctx.tenantScope
    )
    if (result.success) {
      results.push(result.data as unknown as Record<string, unknown>)
      auditEntries.push({
        entityType: 'entry',
        entityId: entryId,
        action: 'update',
        changes: result.data as unknown as Record<string, unknown>,
      })
    } else {
      errors.push({ entryId, error: result.error })
    }
  }

  if (errors.length > 0 && results.length === 0) {
    return {
      success: false,
      error: {
        code: 'BULK_UPDATE_FAILED',
        message: `All ${errors.length} updates failed. First error: ${errors[0]?.error.message}`,
      },
    }
  }

  return {
    success: true,
    data: {
      updated: results,
      errors,
      totalUpdated: results.length,
      totalFailed: errors.length,
    },
    auditEntries,
  }
}

/**
 * Handle updateSingleton command.
 *
 * Singletons have exactly one entry per collection. If no entry exists yet,
 * one is created. Otherwise the existing entry is updated.
 */
export const handleUpdateSingleton: CommandHandler = async (ctx, payload) => {
  const { collectionId, data } = payload as {
    collectionId: string
    data: Record<string, unknown>
  }

  // Find existing entry for this singleton collection
  const listResult = await entriesService.findAll(
    ctx.db,
    { collectionId, page: 1, perPage: 1 },
    ctx.tenantScope
  )
  if (!listResult.success) {
    return { success: false, error: listResult.error }
  }

  const existingEntry = listResult.data.entries[0]

  if (existingEntry) {
    // Capture before-state for webhook events
    const before = existingEntry as unknown as Record<string, unknown>

    // Update existing singleton entry
    const result = await entriesService.update(
      ctx.db,
      existingEntry.id,
      { data },
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
          entityId: existingEntry.id,
          action: 'update',
          changes: result.data as unknown as Record<string, unknown>,
        },
      ],
    }
  }

  // Create new singleton entry
  const result = await entriesService.create(
    ctx.db,
    { collectionId, data, status: 'draft' },
    ctx.actor.userId,
    ctx.tenantScope
  )
  if (!result.success) {
    return { success: false, error: result.error }
  }

  return {
    success: true,
    data: result.data as unknown as Record<string, unknown>,
    auditEntries: [
      {
        entityType: 'entry',
        entityId: result.data.id,
        action: 'create',
        changes: result.data as unknown as Record<string, unknown>,
      },
    ],
  }
}
