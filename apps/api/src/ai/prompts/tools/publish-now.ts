import { type } from 'arktype'
import { id } from '@/shared/schemas'

/**
 * AI tool for immediately publishing an entry.
 *
 * This tool transitions an entry to the 'published' status, making it
 * visible in the public API. Use when the user wants content to go live immediately.
 */
export const publishNowTool = {
  name: 'publishNow',
  description:
    'Publish an entry immediately, making it live and visible in the public API. Use this when the user wants to publish content right away (e.g., "publish this post", "make this live", "go live with the announcement").',
  parameters: type({
    entryId: id,
  }),
}

export type PublishNowToolParams = typeof publishNowTool.parameters.infer
