import { Type, createSchema } from '@/shared/schemas/typebox'
import { id } from '@/shared/schemas'

/**
 * AI tool for canceling a scheduled publish or unpublish transition.
 *
 * This tool removes any pending scheduled transition for an entry, preventing
 * the automatic publish/unpublish action. Use when the user wants to cancel
 * a previously scheduled action.
 */
export const cancelScheduleTool = {
  name: 'cancelSchedule',
  description:
    'Cancel any scheduled publish or unpublish transition for an entry. Use this when the user wants to cancel a scheduled action (e.g., "cancel the scheduled publish", "don\'t publish that post tomorrow", "remove the scheduled unpublish").',
  parameters: createSchema(
    Type.Object({
      entryId: id,
    })
  ),
}

export type CancelScheduleToolParams = typeof cancelScheduleTool.parameters.infer
