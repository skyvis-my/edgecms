import { Type, createSchema } from '@/shared/schemas/typebox'
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
  parameters: createSchema(
    Type.Object({
      entryIds: Type.Array(id),
      updates: Type.Object({
        status: Type.Optional(entryStatus),
        data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
    })
  ),
}

export type BulkUpdateToolParams = typeof bulkUpdateTool.parameters.infer
