import { type } from 'arktype'
import { id } from '@/shared/schemas'

/**
 * AI tool for unlinking two entries.
 *
 * This tool allows the AI to remove relationships between entries.
 * The relationship is identified by the source entry, target entry, and field name.
 */
export const unlinkRelationTool = {
  name: 'unlinkRelation',
  description:
    'Remove a relationship between two entries. Use this when the user wants to unlink content (e.g., "remove the author from this post", "unlink this product from the category", "remove the association"). Specify the source entry (the one that owns the relation), the target entry (what it currently references), and the field name.',
  parameters: type({
    sourceEntryId: id,
    targetEntryId: id,
    fieldName: 'string',
  }),
}

export type UnlinkRelationToolParams = typeof unlinkRelationTool.parameters.infer
