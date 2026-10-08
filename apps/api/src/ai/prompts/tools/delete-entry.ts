import { type } from 'arktype'
import { id } from '@/shared/schemas'

/**
 * AI tool for deleting an entry.
 *
 * This tool allows the AI to permanently remove entries from collections.
 * Use with caution — this operation cannot be undone.
 */
export const deleteEntryTool = {
  name: 'deleteEntry',
  description:
    'Delete an entry permanently. Use this when the user explicitly requests deletion (e.g., "delete this post", "remove the product"). This operation is irreversible — use only when clearly intended.',
  parameters: type({
    entryId: id,
  }),
}

export type DeleteEntryToolParams = typeof deleteEntryTool.parameters.infer
