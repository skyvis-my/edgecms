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

  const result = await relationsService.link(ctx.db, {
    sourceEntryId,
    targetEntryId,
    sourceCollectionId,
    targetCollectionId,
    relationType,
    fieldName,
    sortOrder,
  })

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

  const result = await relationsService.unlink(ctx.db, {
    sourceEntryId,
    targetEntryId,
    fieldName,
  })

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
