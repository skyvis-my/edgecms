import { type } from 'arktype'
import { id } from '@/shared/schemas'

/**
 * AI tool for immediately unpublishing an entry.
 *
 * This tool transitions an entry from 'published' to 'draft' status,
 * removing it from the public API. Use when content needs to be taken down.
 */
export const unpublishNowTool = {
  name: 'unpublishNow',
  description:
    'Unpublish an entry immediately, removing it from the public API and reverting it to draft status. Use this when the user wants to take content offline (e.g., "unpublish this post", "take this down", "revert to draft").',
  parameters: type({
    entryId: id,
  }),
}

export type UnpublishNowToolParams = typeof unpublishNowTool.parameters.infer
