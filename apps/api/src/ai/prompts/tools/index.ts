/**
 * AI Tool Registry
 *
 * Central export point for all AI tools (command definitions).
 * Each tool maps to a command type and provides the schema for AI SDK tool calling.
 */

import { bulkUpdateTool } from './bulk-update'
import { cancelScheduleTool } from './cancel-schedule'
import { createEntryTool } from './create-entry'
import { deleteEntryTool } from './delete-entry'
import { linkRelationTool } from './link-relation'
import { publishNowTool } from './publish-now'
import { schedulePublishTool } from './schedule-publish'
import { scheduleUnpublishTool } from './schedule-unpublish'
import { transactionTool } from './transaction'
import { unlinkRelationTool } from './unlink-relation'
import { unpublishNowTool } from './unpublish-now'
import { updateEntryTool } from './update-entry'
import { updateSingletonTool } from './update-singleton'

export { type BulkUpdateToolParams, bulkUpdateTool } from './bulk-update'
export { type CancelScheduleToolParams, cancelScheduleTool } from './cancel-schedule'
export { type CreateEntryToolParams, createEntryTool } from './create-entry'
export { type DeleteEntryToolParams, deleteEntryTool } from './delete-entry'
export { type LinkRelationToolParams, linkRelationTool } from './link-relation'
export { type PublishNowToolParams, publishNowTool } from './publish-now'
export { type SchedulePublishToolParams, schedulePublishTool } from './schedule-publish'
export { type ScheduleUnpublishToolParams, scheduleUnpublishTool } from './schedule-unpublish'
export { type TransactionToolParams, transactionTool } from './transaction'
export { type UnlinkRelationToolParams, unlinkRelationTool } from './unlink-relation'
export { type UnpublishNowToolParams, unpublishNowTool } from './unpublish-now'
export { type UpdateEntryToolParams, updateEntryTool } from './update-entry'
export { type UpdateSingletonToolParams, updateSingletonTool } from './update-singleton'

/**
 * All available AI tools indexed by command type.
 */
export const AI_TOOLS = {
  createEntry: createEntryTool,
  updateEntry: updateEntryTool,
  deleteEntry: deleteEntryTool,
  bulkUpdate: bulkUpdateTool,
  linkRelation: linkRelationTool,
  unlinkRelation: unlinkRelationTool,
  publishNow: publishNowTool,
  unpublishNow: unpublishNowTool,
  schedulePublish: schedulePublishTool,
  scheduleUnpublish: scheduleUnpublishTool,
  cancelSchedule: cancelScheduleTool,
  updateSingleton: updateSingletonTool,
  transaction: transactionTool,
} as const
