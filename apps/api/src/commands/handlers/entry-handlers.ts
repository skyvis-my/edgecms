import { eq } from 'drizzle-orm'
import { entries, entryVersions } from '@/database/schema'
import { entriesService } from '@/entries/entries.service'
import type { EntryRow } from '@/entries/entries.repository'
import { scheduleDeferredWork } from '../deferred-work'
import type { CommandHandler } from '../engine'
import { isCommandLifecycleStatus } from '@/shared/schemas/entry'
import { retentionService } from '@/versioning/retention.service'

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

  // QRY-05: cache the created row on the context for downstream reuse.
  ctx.cachedEntry = result.data as EntryRow

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

  // Capture before-state for webhook events, reusing the context-cached
  // row when this context already loaded the same entry (QRY-05).
  const cachedBefore =
    ctx.cachedEntry && (ctx.cachedEntry as EntryRow).id === entryId
      ? (ctx.cachedEntry as unknown as Record<string, unknown>)
      : null
  const beforeResult = cachedBefore
    ? { success: true as const, data: ctx.cachedEntry as EntryRow }
    : await entriesService.findById(ctx.db, entryId, ctx.tenantScope)
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

  // QRY-05: refresh the context cache with the updated row.
  ctx.cachedEntry = result.data as EntryRow
  scheduleDeferredWork(
    ctx,
    retentionService.enforceRetention(ctx.db, entryId),
    'version_retention'
  )

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

  if (ctx.cachedEntry && (ctx.cachedEntry as EntryRow).id === entryId) {
    ctx.cachedEntry = null
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

  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'entryIds must be a non-empty array' },
    }
  }
  if (entryIds.length > 100) {
    return {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'entryIds exceeds maximum of 100' },
    }
  }

  const results: Record<string, unknown>[] = []
  const auditEntries: Array<{
    entityType: string
    entityId: string
    action: string
    changes?: Record<string, unknown>
  }> = []
  const errors: Array<{ entryId: string; error: { code: string; message: string } }> = []

  // QRY-02: pre-fetch all entries in a single findByIds query when the
  // service supports it, so lifecycle validation happens in memory instead
  // of issuing N sequential findById roundtrips.
  let prefetched: Map<string, EntryRow> | null = null
  if (typeof (entriesService as unknown as { findByIds?: unknown }).findByIds === 'function') {
    try {
      const batchResult = await entriesService.findByIds(ctx.db, entryIds, ctx.tenantScope)
      if (batchResult.success) {
        prefetched = new Map(batchResult.data.map((e) => [e.id, e as EntryRow]))
      }
    } catch {
      prefetched = null
    }
  }

  async function loadBefore(entryId: string) {
    const hit = prefetched?.get(entryId)
    if (hit) return { success: true as const, data: hit }
    return entriesService.findById(ctx.db, entryId, ctx.tenantScope)
  }

  if (updates.status !== undefined) {
    for (const entryId of entryIds) {
      const beforeResult = await loadBefore(entryId)
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

  // ATM-06: when every target is prefetched and the driver supports
  // db.batch(), apply all updates + version snapshots in batched D1
  // roundtrips (chunked) instead of 2N sequential statements.
  const canBatch =
    prefetched !== null &&
    typeof (ctx.db as unknown as { batch?: unknown }).batch === 'function' &&
    (updates as { slug?: string }).slug === undefined
  if (canBatch && prefetched) {
    const targets: EntryRow[] = []
    for (const entryId of entryIds) {
      const row = (prefetched as Map<string, EntryRow>).get(entryId)
      if (!row) {
        errors.push({ entryId, error: { code: 'NOT_FOUND', message: `Entry '${entryId}' not found` } })
      } else {
        targets.push(row)
      }
    }
    const now = new Date().toISOString()
    const CHUNK_ENTRIES = 25
    for (let i = 0; i < targets.length; i += CHUNK_ENTRIES) {
      const chunk = targets.slice(i, i + CHUNK_ENTRIES)
      const statements = chunk.flatMap((row) => [
        ctx.db
          .update(entries)
          .set({
            ...(updates.status !== undefined ? { status: updates.status } : {}),
            ...(updates.data !== undefined ? { data: updates.data } : {}),
            version: row.version + 1,
            updatedAt: now,
          })
          .where(eq(entries.id, row.id))
          .returning(),
        ctx.db
          .insert(entryVersions)
          .values({
            id: crypto.randomUUID(),
            entryId: row.id,
            version: row.version,
            data: row.data,
            createdBy: ctx.actor.userId ?? null,
            createdAt: now,
          })
          .returning(),
      ])
      try {
        const settled = (await (ctx.db as any).batch(statements)) as unknown as EntryRow[][]
        chunk.forEach((row, idx) => {
          const updated = (settled[idx * 2] as EntryRow[] | undefined)?.[0]
          if (updated) {
            results.push(updated as unknown as Record<string, unknown>)
            auditEntries.push({
              entityType: 'entry',
              entityId: row.id,
              action: 'update',
              changes: updated as unknown as Record<string, unknown>,
            })
            if (idx === 0) ctx.cachedEntry = updated
            scheduleDeferredWork(
              ctx,
              retentionService.enforceRetention(ctx.db, row.id),
              'version_retention'
            )
          } else {
            errors.push({ entryId: row.id, error: { code: 'NOT_FOUND', message: `Entry '${row.id}' not found` } })
          }
        })
      } catch {
        // Batch chunk failed (e.g. mock driver): fall back to per-entry
        // service updates for this chunk to preserve partial-success semantics.
        for (const row of chunk) {
          const result = await entriesService.update(
            ctx.db,
            row.id,
            updates,
            ctx.actor.userId,
            undefined,
            ctx.tenantScope
          )
          if (result.success) {
            results.push(result.data as unknown as Record<string, unknown>)
            auditEntries.push({
              entityType: 'entry',
              entityId: row.id,
              action: 'update',
              changes: result.data as unknown as Record<string, unknown>,
            })
            scheduleDeferredWork(
              ctx,
              retentionService.enforceRetention(ctx.db, row.id),
              'version_retention'
            )
          } else {
            errors.push({ entryId: row.id, error: result.error })
          }
        }
      }
    }
    // Ensure audit entries carry full rows even when the batch driver
    // returns empty returning() payloads (some D1 mocks).
    if (results.length === 0 && errors.length === 0) {
      for (const entryId of entryIds) {
        errors.push({ entryId, error: { code: 'BULK_UPDATE_FAILED', message: 'Batch update returned no rows' } })
      }
    }
  } else {
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
        scheduleDeferredWork(
          ctx,
          retentionService.enforceRetention(ctx.db, entryId),
          'version_retention'
        )
      } else {
        errors.push({ entryId, error: result.error })
      }
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

    // QRY-05: cache the updated singleton row for downstream reuse.
    ctx.cachedEntry = result.data as EntryRow
    scheduleDeferredWork(
      ctx,
      retentionService.enforceRetention(ctx.db, existingEntry.id),
      'version_retention'
    )

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

  // Create new singleton entry with canonical slug to leverage unique constraint
  const result = await entriesService.create(
    ctx.db,
    { collectionId, slug: '__singleton__', data, status: 'draft' },
    ctx.actor.userId,
    ctx.tenantScope
  )
  if (!result.success) {
    // If concurrent creation raced, re-fetch the winner and update
    const retryList = await entriesService.findAll(
      ctx.db,
      { collectionId, page: 1, perPage: 1 },
      ctx.tenantScope
    )
    const winner = retryList.success ? retryList.data.entries[0] : undefined
    if (winner) {
      const updateResult = await entriesService.update(
        ctx.db,
        winner.id,
        { data },
        ctx.actor.userId,
        undefined,
        ctx.tenantScope
      )
      if (updateResult.success) {
        ctx.cachedEntry = updateResult.data as EntryRow
        scheduleDeferredWork(
          ctx,
          retentionService.enforceRetention(ctx.db, winner.id),
          'version_retention'
        )
        return {
          success: true,
          data: updateResult.data as unknown as Record<string, unknown>,
          before: winner as unknown as Record<string, unknown>,
          auditEntries: [
            {
              entityType: 'entry',
              entityId: winner.id,
              action: 'update',
              changes: updateResult.data as unknown as Record<string, unknown>,
            },
          ],
        }
      }
    }
    return { success: false, error: result.error }
  }

  // ATM-04: singleton rows use the canonical '__singleton__' slug so the
  // (collectionId, slug) unique constraint serializes concurrent creators;
  // the loser re-fetches the winner above instead of inserting a duplicate.
  // QRY-05: cache the created row for downstream reuse.
  ctx.cachedEntry = result.data as EntryRow

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
