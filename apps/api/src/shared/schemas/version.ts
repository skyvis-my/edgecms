import { Type, createSchema } from './typebox'
import { id, timestamp } from './common'

/**
 * Version schemas for EdgeCMS.
 *
 * Version-related data types for version history, diff comparison, and rollback.
 */

/**
 * A version snapshot of an entry at a specific point in time.
 */
export const entryVersion = createSchema(
  Type.Object({
    id,
    entryId: id,
    version: Type.Integer({ minimum: 1 }),
    data: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
    createdBy: Type.Union([Type.String(), Type.Null()]),
    createdAt: timestamp,
  })
)

export type EntryVersion = typeof entryVersion.infer

/**
 * Diff action type.
 */
export const diffAction = createSchema(
  Type.Union([
    Type.Literal('add'),
    Type.Literal('update'),
    Type.Literal('remove'),
  ])
)

export type DiffAction = typeof diffAction.infer

/**
 * A single field-level diff entry between two versions.
 */
export const versionDiffEntry = createSchema(
  Type.Object({
    field: Type.String(),
    before: Type.Unknown(),
    after: Type.Unknown(),
    action: diffAction,
  })
)

export type VersionDiffEntry = typeof versionDiffEntry.infer

/**
 * Paginated list of versions.
 */
export const versionListResponse = createSchema(
  Type.Object({
    versions: Type.Array(entryVersion),
    total: Type.Integer({ minimum: 0 }),
    page: Type.Integer({ minimum: 1 }),
    perPage: Type.Integer({ minimum: 1 }),
  })
)

export type VersionListResponse = typeof versionListResponse.infer

/**
 * Response for rollback operation.
 */
export const rollbackResponse = createSchema(
  Type.Object({
    entry: Type.Record(Type.String(), Type.Unknown()),
    newVersion: entryVersion,
    message: Type.String(),
  })
)

export type RollbackResponse = typeof rollbackResponse.infer
