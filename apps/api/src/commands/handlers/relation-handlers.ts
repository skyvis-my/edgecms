import { relationsService } from '@/relations/relations.service'
import type { CommandHandler } from '../engine'

/**
 * Handle linkRelation command.
 *
 * Delegates to the relations service to create a new link between entries.
 */
export const handleLinkRelation: CommandHandler = async (ctx, payload) => {
  const {
    sourceEntryId,
    targetEntryId,
    sourceCollectionId,
    targetCollectionId,
    relationType,
    fieldName,
    sortOrder,
  } = payload as {
    sourceEntryId: string
    targetEntryId: string
    sourceCollectionId: string
    targetCollectionId: string
    relationType: 'one-to-one' | 'one-to-many' | 'many-to-many'
    fieldName: string
    sortOrder?: number
  }

  // Tenant scope: prefer explicit scope, fall back to a non-global sync
  // channel (mirrors engine tenantScope derivation). Spread conditionally so
  // unscoped calls keep their existing 2-arg shape.
  const tenantId =
    ctx.tenantScope ??
    (ctx.syncChannel && ctx.syncChannel !== 'global' ? ctx.syncChannel : undefined)

  const result = await relationsService.link(
    ctx.db,
    {
      sourceEntryId,
      targetEntryId,
      sourceCollectionId,
      targetCollectionId,
      relationType,
      fieldName,
      sortOrder,
    },
    ...(tenantId ? [tenantId] : [])
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  return {
    success: true,
    data: result.data as unknown as Record<string, unknown>,
    auditEntries: [
      {
        entityType: 'relation',
        entityId: result.data.id,
        action: 'link',
        changes: {
          sourceEntryId,
          targetEntryId,
          sourceCollectionId,
          targetCollectionId,
          relationType,
          fieldName,
          sortOrder: sortOrder ?? 0,
        },
      },
    ],
  }
}

/**
 * Handle unlinkRelation command.
 *
 * Delegates to the relations service to remove a link between entries.
 */
export const handleUnlinkRelation: CommandHandler = async (ctx, payload) => {
  const { sourceEntryId, targetEntryId, fieldName } = payload as {
    sourceEntryId: string
    targetEntryId: string
    fieldName: string
  }

  // Tenant scope (mirrors handleLinkRelation above).
  const tenantId =
    ctx.tenantScope ??
    (ctx.syncChannel && ctx.syncChannel !== 'global' ? ctx.syncChannel : undefined)

  const result = await relationsService.unlink(
    ctx.db,
    {
      sourceEntryId,
      targetEntryId,
      fieldName,
    },
    ...(tenantId ? [tenantId] : [])
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  return {
    success: true,
    data: result.data as unknown as Record<string, unknown>,
    auditEntries: [
      {
        entityType: 'relation',
        entityId: `${sourceEntryId}:${fieldName}:${targetEntryId}`,
        action: 'unlink',
        changes: { sourceEntryId, targetEntryId, fieldName },
      },
    ],
  }
}
