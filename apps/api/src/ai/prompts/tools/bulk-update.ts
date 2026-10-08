import { type } from 'arktype'
import { entryStatus, id } from '@/shared/schemas'

/**
 * AI tool for bulk updating multiple entries.
 *
 * This tool allows the AI to apply the same updates to multiple entries at once.
 * Useful for batch operations like "archive old content" or "update product categories".
 */
export const bulkUpdateTool = {
  name: 'bulkUpdate',
  description:
    'Update multiple entries at once with the same non-publishing changes. Use this for batch operations such as "archive all posts from last year" or "update the category for these products". Do not use this tool to publish, schedule, or unpublish entries; use publishNow, schedulePublish, cancelSchedule, or unpublishNow lifecycle commands for those changes.',
  parameters: type({
    entryIds: id.array(),
    updates: type({
      'status?': entryStatus,
      'data?': 'Record<string, unknown>',
    }),
  }),
}

export type BulkUpdateToolParams = typeof bulkUpdateTool.parameters.infer
