import { entriesRepository } from '@/entries/entries.repository'
import type { CommandContext } from './engine'

/**
 * A single field-level diff entry.
 *
 * Describes the change to one field in a command's affected entity.
 */
export type DiffEntry = {
  field: string
  before: unknown
  after: unknown
  action: 'add' | 'update' | 'remove'
}

/**
 * Compute field-level diffs for a command without executing mutations.
 *
 * This function simulates the command's effects by fetching current state
 * and comparing it with the proposed changes. It does NOT modify the database.
 *
 * @param ctx - Command execution context with DB connection
 * @param commandType - The command type discriminant
 * @param payload - Command-specific payload
 * @returns Array of field-level diff entries
 */
export async function computeDiff(
  ctx: CommandContext,
  commandType: string,
  payload: Record<string, unknown>
): Promise<DiffEntry[]> {
  switch (commandType) {
    case 'createEntry':
      return computeCreateEntryDiff(ctx, payload)
    case 'updateEntry':
      return computeUpdateEntryDiff(ctx, payload)
    case 'deleteEntry':
      return computeDeleteEntryDiff(ctx, payload)
    case 'bulkUpdate':
      return computeBulkUpdateDiff(ctx, payload)
    case 'updateSingleton':
      return computeUpdateSingletonDiff(ctx, payload)
    case 'linkRelation':
      return computeLinkRelationDiff(ctx, payload)
    case 'unlinkRelation':
      return computeUnlinkRelationDiff(ctx, payload)
    case 'publishNow':
      return computePublishNowDiff(ctx, payload)
    case 'unpublishNow':
      return computeUnpublishNowDiff(ctx, payload)
    default:
      return []
  }
}

/**
 * Compute diff for createEntry command.
 *
 * All fields in the data payload are 'add' diffs (before: null).
 */
async function computeCreateEntryDiff(
  _ctx: CommandContext,
  payload: Record<string, unknown>
): Promise<DiffEntry[]> {
  const {
    slug,
    status = 'draft',
    data,
  } = payload as {
    slug?: string
    status?: string
    data: Record<string, unknown>
  }

  const diffs: DiffEntry[] = []

  // Status is always added
  diffs.push({
    field: 'status',
    before: null,
    after: status,
    action: 'add',
  })

  // Slug if provided (or will be auto-generated)
  if (slug) {
    diffs.push({
      field: 'slug',
      before: null,
      after: slug,
      action: 'add',
    })
  }

  // Each field in data is an 'add' diff
  for (const [fieldName, value] of Object.entries(data)) {
    diffs.push({
      field: fieldName,
      before: null,
      after: value,
      action: 'add',
    })
  }

  return diffs
}

/**
 * Compute diff for updateEntry command.
 *
 * Fetches the current entry and compares each field in the payload.
 */
async function computeUpdateEntryDiff(
  ctx: CommandContext,
  payload: Record<string, unknown>
): Promise<DiffEntry[]> {
  const { entryId, slug, status, data } = payload as {
    entryId: string
    slug?: string
    status?: string
    data?: Record<string, unknown>
  }

  const existing = await entriesRepository.findById(ctx.db, entryId, ctx.tenantScope)
  if (!existing) {
    // Entry not found - return empty diff (command will fail on execution)
    return []
  }

  const diffs: DiffEntry[] = []

  // Check slug change
  if (slug !== undefined && slug !== existing.slug) {
    diffs.push({
      field: 'slug',
      before: existing.slug,
      after: slug,
      action: 'update',
    })
  }

  // Check status change
  if (status !== undefined && status !== existing.status) {
    diffs.push({
      field: 'status',
      before: existing.status,
      after: status,
      action: 'update',
    })
  }

  // Check data field changes
  if (data) {
    for (const [fieldName, newValue] of Object.entries(data)) {
      const oldValue = existing.data[fieldName]

      // Simple equality check (deep equality would be more robust but adds complexity)
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        const action = oldValue === undefined ? 'add' : 'update'
        diffs.push({
          field: fieldName,
          before: oldValue,
          after: newValue,
          action,
        })
      }
    }
  }

  return diffs
}

/**
 * Compute diff for deleteEntry command.
 *
 * All fields are 'remove' diffs (after: null).
 */
async function computeDeleteEntryDiff(
  ctx: CommandContext,
  payload: Record<string, unknown>
): Promise<DiffEntry[]> {
  const { entryId } = payload as { entryId: string }

  const existing = await entriesRepository.findById(ctx.db, entryId, ctx.tenantScope)
  if (!existing) {
    return []
  }

  const diffs: DiffEntry[] = []

  // Status removed
  diffs.push({
    field: 'status',
    before: existing.status,
    after: null,
    action: 'remove',
  })

  // Slug removed
  diffs.push({
    field: 'slug',
    before: existing.slug,
    after: null,
    action: 'remove',
  })

  // All data fields removed
  for (const [fieldName, value] of Object.entries(existing.data)) {
    diffs.push({
      field: fieldName,
      before: value,
      after: null,
      action: 'remove',
    })
  }

  return diffs
}

/**
 * Compute diff for bulkUpdate command.
 *
 * Fetches all target entries and computes diffs for each.
 * Returns a combined list of diffs with field names prefixed by entry ID.
 */
async function computeBulkUpdateDiff(
  ctx: CommandContext,
  payload: Record<string, unknown>
): Promise<DiffEntry[]> {
  const { entryIds, updates } = payload as {
    entryIds: string[]
    updates: { status?: string; data?: Record<string, unknown> }
  }

  const allDiffs: DiffEntry[] = []

  for (const entryId of entryIds) {
    const entryDiffs = await computeUpdateEntryDiff(ctx, {
      entryId,
      ...updates,
    })

    // Prefix field names with entry ID for disambiguation
    for (const diff of entryDiffs) {
      allDiffs.push({
        ...diff,
        field: `[${entryId}].${diff.field}`,
      })
    }
  }

  return allDiffs
}

/**
 * Compute diff for updateSingleton command.
 *
 * Finds the singleton entry and computes an update diff.
 * If no entry exists, computes a create diff.
 */
async function computeUpdateSingletonDiff(
  ctx: CommandContext,
  payload: Record<string, unknown>
): Promise<DiffEntry[]> {
  const { collectionId, data } = payload as {
    collectionId: string
    data: Record<string, unknown>
  }

  // Find existing singleton entry
  const listResult = await entriesRepository.findAll(ctx.db, {
    collectionId,
    tenantId: ctx.tenantScope,
    page: 1,
    perPage: 1,
  })

  const existing = listResult.rows[0]

  if (existing) {
    // Singleton exists - compute update diff
    return computeUpdateEntryDiff(ctx, {
      entryId: existing.id,
      data,
    })
  }

  // No singleton exists - compute create diff
  return computeCreateEntryDiff(ctx, {
    collectionId,
    data,
    status: 'draft',
  })
}

/**
 * Compute diff for linkRelation command.
 *
 * Returns a single 'add' diff for the relation.
 */
async function computeLinkRelationDiff(
  _ctx: CommandContext,
  payload: Record<string, unknown>
): Promise<DiffEntry[]> {
  const { fieldName, targetEntryId } = payload as {
    fieldName: string
    targetEntryId: string
  }

  return [
    {
      field: fieldName,
      before: null,
      after: targetEntryId,
      action: 'add',
    },
  ]
}

/**
 * Compute diff for unlinkRelation command.
 *
 * Returns a single 'remove' diff for the relation.
 */
async function computeUnlinkRelationDiff(
  _ctx: CommandContext,
  payload: Record<string, unknown>
): Promise<DiffEntry[]> {
  const { fieldName, targetEntryId } = payload as {
    fieldName: string
    targetEntryId: string
  }

  return [
    {
      field: fieldName,
      before: targetEntryId,
      after: null,
      action: 'remove',
    },
  ]
}

/**
 * Compute diff for publishNow command.
 *
 * Returns a single 'update' diff for the status field.
 */
async function computePublishNowDiff(
  ctx: CommandContext,
  payload: Record<string, unknown>
): Promise<DiffEntry[]> {
  const { entryId } = payload as { entryId: string }

  const existing = await entriesRepository.findById(ctx.db, entryId, ctx.tenantScope)
  if (!existing) {
    return []
  }

  return [
    {
      field: 'status',
      before: existing.status,
      after: 'published',
      action: 'update',
    },
  ]
}

/**
 * Compute diff for unpublishNow command.
 *
 * Returns a single 'update' diff for the status field.
 */
async function computeUnpublishNowDiff(
  ctx: CommandContext,
  payload: Record<string, unknown>
): Promise<DiffEntry[]> {
  const { entryId } = payload as { entryId: string }

  const existing = await entriesRepository.findById(ctx.db, entryId, ctx.tenantScope)
  if (!existing) {
    return []
  }

  return [
    {
      field: 'status',
      before: existing.status,
      after: 'draft',
      action: 'update',
    },
  ]
}
