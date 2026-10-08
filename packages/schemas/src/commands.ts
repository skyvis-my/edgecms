import { type } from 'arktype'

export const id = 'string > 0'
export const timestamp = 'string.date.iso'
export const entryStatus = type("'draft' | 'scheduled' | 'published' | 'archived'")
export const relationType = type("'one-to-one' | 'one-to-many' | 'many-to-many'")

export const commandType = type(
  "'createEntry' | 'updateEntry' | 'deleteEntry' | 'bulkUpdate' | 'updateSingleton' | 'linkRelation' | 'unlinkRelation' | 'publishNow' | 'unpublishNow' | 'schedulePublish' | 'scheduleUnpublish' | 'cancelSchedule' | 'transaction'"
)

export type CommandType = typeof commandType.infer

export const createEntryPayload = type({
  collectionId: id,
  'slug?': 'string',
  'status?': entryStatus,
  data: 'Record<string, unknown>',
})
export type CreateEntryPayload = typeof createEntryPayload.infer

export const updateEntryPayload = type({
  entryId: id,
  'slug?': 'string',
  'status?': entryStatus,
  'data?': 'Record<string, unknown>',
})
export type UpdateEntryPayload = typeof updateEntryPayload.infer

export const deleteEntryPayload = type({
  entryId: id,
})
export type DeleteEntryPayload = typeof deleteEntryPayload.infer

export const bulkUpdatePayload = type({
  entryIds: type(id).array(),
  updates: type({
    'status?': entryStatus,
    'data?': 'Record<string, unknown>',
  }),
})
export type BulkUpdatePayload = typeof bulkUpdatePayload.infer

export const updateSingletonPayload = type({
  collectionId: id,
  data: 'Record<string, unknown>',
})
export type UpdateSingletonPayload = typeof updateSingletonPayload.infer

export const linkRelationPayload = type({
  sourceEntryId: id,
  targetEntryId: id,
  sourceCollectionId: id,
  targetCollectionId: id,
  relationType,
  fieldName: 'string',
  'sortOrder?': 'number.integer >= 0',
})
export type LinkRelationPayload = typeof linkRelationPayload.infer

export const unlinkRelationPayload = type({
  sourceEntryId: id,
  targetEntryId: id,
  fieldName: 'string',
})
export type UnlinkRelationPayload = typeof unlinkRelationPayload.infer

export const publishNowPayload = type({
  entryId: id,
})
export type PublishNowPayload = typeof publishNowPayload.infer

export const unpublishNowPayload = type({
  entryId: id,
})
export type UnpublishNowPayload = typeof unpublishNowPayload.infer

export const schedulePublishPayload = type({
  entryId: id,
  publishAt: timestamp,
})
export type SchedulePublishPayload = typeof schedulePublishPayload.infer

export const scheduleUnpublishPayload = type({
  entryId: id,
  unpublishAt: timestamp,
})
export type ScheduleUnpublishPayload = typeof scheduleUnpublishPayload.infer

export const cancelSchedulePayload = type({
  entryId: id,
})
export type CancelSchedulePayload = typeof cancelSchedulePayload.infer

export const commandEnvelope = type({
  type: commandType,
  payload: 'Record<string, unknown>',
  actor: type({
    userId: id,
    source: "'admin' | 'ai' | 'sync' | 'scheduler'",
  }),
  'optimisticVersion?': 'number.integer >= 1',
  'transactionId?': id,
  'dryRun?': 'boolean',
  'previewReceipt?': 'string',
  'idempotencyKey?': 'string',
  timestamp,
})

export const commandEnvelopeSchema = commandEnvelope

export type CommandEnvelope = typeof commandEnvelope.infer

export const transactionPayload = type({
  commands: commandEnvelope.array(),
})

export type TransactionPayload = typeof transactionPayload.infer

export const previewReceiptRecord = type({
  receiptId: id,
  hash: 'string',
  commands: commandEnvelope.array(),
  userId: id,
  'tenantId?': 'string | undefined',
  'explanation?': 'string | undefined',
  'consumedAt?': 'string | undefined',
  createdAt: timestamp,
  expiresAt: timestamp,
})

export type PreviewReceiptRecord = typeof previewReceiptRecord.infer

export const commandResult = type({
  commandId: id,
  type: commandType,
  status: "'success' | 'failed' | 'dry_run'",
  'data?': 'Record<string, unknown>',
  'error?': type({
    code: 'string',
    message: 'string',
  }),
  'diff?': 'Record<string, unknown>[]',
  'previewReceipt?': 'string',
  executedAt: timestamp,
})

export const commandResultSchema = commandResult

export type CommandResult = typeof commandResult.infer
