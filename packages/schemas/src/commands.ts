import { Type, createSchema } from './typebox'

export const id = createSchema(Type.String({ minLength: 1 }))
export const timestamp = createSchema(Type.String({ minLength: 1 }))
export const entryStatus = createSchema(
  Type.Union([
    Type.Literal('draft'),
    Type.Literal('scheduled'),
    Type.Literal('published'),
    Type.Literal('archived'),
  ])
)
export const relationType = createSchema(
  Type.Union([
    Type.Literal('one-to-one'),
    Type.Literal('one-to-many'),
    Type.Literal('many-to-many'),
  ])
)

export const commandType = createSchema(
  Type.Union([
    Type.Literal('createEntry'),
    Type.Literal('updateEntry'),
    Type.Literal('deleteEntry'),
    Type.Literal('bulkUpdate'),
    Type.Literal('updateSingleton'),
    Type.Literal('linkRelation'),
    Type.Literal('unlinkRelation'),
    Type.Literal('publishNow'),
    Type.Literal('unpublishNow'),
    Type.Literal('schedulePublish'),
    Type.Literal('scheduleUnpublish'),
    Type.Literal('cancelSchedule'),
    Type.Literal('transaction'),
  ])
)

export type CommandType = typeof commandType.infer

export const createEntryPayload = createSchema(
  Type.Object({
    collectionId: id,
    slug: Type.Optional(Type.String()),
    status: Type.Optional(entryStatus),
    data: Type.Record(Type.String(), Type.Unknown()),
  })
)
export type CreateEntryPayload = typeof createEntryPayload.infer

export const updateEntryPayload = createSchema(
  Type.Object({
    entryId: id,
    slug: Type.Optional(Type.String()),
    status: Type.Optional(entryStatus),
    data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  })
)
export type UpdateEntryPayload = typeof updateEntryPayload.infer

export const deleteEntryPayload = createSchema(
  Type.Object({
    entryId: id,
  })
)
export type DeleteEntryPayload = typeof deleteEntryPayload.infer

export const bulkUpdatePayload = createSchema(
  Type.Object({
    entryIds: Type.Array(id),
    updates: Type.Object({
      status: Type.Optional(entryStatus),
      data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
  })
)
export type BulkUpdatePayload = typeof bulkUpdatePayload.infer

export const updateSingletonPayload = createSchema(
  Type.Object({
    collectionId: id,
    data: Type.Record(Type.String(), Type.Unknown()),
  })
)
export type UpdateSingletonPayload = typeof updateSingletonPayload.infer

export const linkRelationPayload = createSchema(
  Type.Object({
    sourceEntryId: id,
    targetEntryId: id,
    sourceCollectionId: id,
    targetCollectionId: id,
    relationType,
    fieldName: Type.String(),
    sortOrder: Type.Optional(Type.Integer({ minimum: 0 })),
  })
)
export type LinkRelationPayload = typeof linkRelationPayload.infer

export const unlinkRelationPayload = createSchema(
  Type.Object({
    sourceEntryId: id,
    targetEntryId: id,
    fieldName: Type.String(),
  })
)
export type UnlinkRelationPayload = typeof unlinkRelationPayload.infer

export const publishNowPayload = createSchema(
  Type.Object({
    entryId: id,
  })
)
export type PublishNowPayload = typeof publishNowPayload.infer

export const unpublishNowPayload = createSchema(
  Type.Object({
    entryId: id,
  })
)
export type UnpublishNowPayload = typeof unpublishNowPayload.infer

export const schedulePublishPayload = createSchema(
  Type.Object({
    entryId: id,
    publishAt: timestamp,
  })
)
export type SchedulePublishPayload = typeof schedulePublishPayload.infer

export const scheduleUnpublishPayload = createSchema(
  Type.Object({
    entryId: id,
    unpublishAt: timestamp,
  })
)
export type ScheduleUnpublishPayload = typeof scheduleUnpublishPayload.infer

export const cancelSchedulePayload = createSchema(
  Type.Object({
    entryId: id,
  })
)
export type CancelSchedulePayload = typeof cancelSchedulePayload.infer

export const commandEnvelope = createSchema(
  Type.Object({
    type: commandType,
    payload: Type.Record(Type.String(), Type.Unknown()),
    actor: Type.Object({
      userId: id,
      source: Type.Union([
        Type.Literal('admin'),
        Type.Literal('ai'),
        Type.Literal('sync'),
        Type.Literal('scheduler'),
      ]),
    }),
    optimisticVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    transactionId: Type.Optional(id),
    dryRun: Type.Optional(Type.Boolean()),
    previewReceipt: Type.Optional(Type.String()),
    idempotencyKey: Type.Optional(Type.String()),
    timestamp,
  })
)

export const commandEnvelopeSchema = commandEnvelope

export type CommandEnvelope = typeof commandEnvelope.infer

export const transactionPayload = createSchema(
  Type.Object({
    commands: Type.Array(commandEnvelope),
  })
)

export type TransactionPayload = typeof transactionPayload.infer

export const previewReceiptRecord = createSchema(
  Type.Object({
    receiptId: id,
    hash: Type.String(),
    commands: Type.Array(commandEnvelope),
    userId: id,
    tenantId: Type.Optional(Type.String()),
    explanation: Type.Optional(Type.String()),
    consumedAt: Type.Optional(Type.String()),
    createdAt: timestamp,
    expiresAt: timestamp,
  })
)

export type PreviewReceiptRecord = typeof previewReceiptRecord.infer

export const commandResult = createSchema(
  Type.Object({
    commandId: id,
    type: commandType,
    status: Type.Union([
      Type.Literal('success'),
      Type.Literal('failed'),
      Type.Literal('dry_run'),
    ]),
    data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    error: Type.Optional(
      Type.Object({
        code: Type.String(),
        message: Type.String(),
      })
    ),
    diff: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown()))),
    previewReceipt: Type.Optional(Type.String()),
    executedAt: timestamp,
  })
)

export const commandResultSchema = commandResult

export type CommandResult = typeof commandResult.infer
