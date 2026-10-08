import { type } from 'arktype'
import { id, timestamp } from '@/shared/schemas'

/**
 * AI tool for scheduling an entry to be published at a future date/time.
 *
 * This tool creates a scheduled transition that will automatically publish
 * the entry at the specified timestamp. Use when the user wants to publish
 * content at a specific future time.
 */
export const schedulePublishTool = {
  name: 'schedulePublish',
  description:
    'Schedule an entry to be published at a specific future date and time. Use this when the user wants to publish content later (e.g., "publish this post tomorrow at 9am", "schedule this announcement for next Monday", "make this live on Friday").',
  parameters: type({
    entryId: id,
    publishAt: timestamp,
  }),
}

export type SchedulePublishToolParams = typeof schedulePublishTool.parameters.infer
