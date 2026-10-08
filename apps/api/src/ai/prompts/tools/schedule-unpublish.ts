import { type } from 'arktype'
import { id, timestamp } from '@/shared/schemas'

/**
 * AI tool for scheduling an entry to be unpublished at a future date/time.
 *
 * This tool creates a scheduled transition that will automatically unpublish
 * the entry at the specified timestamp. Use when the user wants to take content
 * offline at a specific future time.
 */
export const scheduleUnpublishTool = {
  name: 'scheduleUnpublish',
  description:
    'Schedule an entry to be unpublished at a specific future date and time. Use this when the user wants to take content offline later (e.g., "unpublish this post tomorrow", "take this down on Friday", "hide this promotion after the sale ends").',
  parameters: type({
    entryId: id,
    unpublishAt: timestamp,
  }),
}

export type ScheduleUnpublishToolParams = typeof scheduleUnpublishTool.parameters.infer
