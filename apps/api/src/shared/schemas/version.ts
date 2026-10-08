import { type } from 'arktype'
import { id, timestamp } from './common'

/**
 * Version schemas for EdgeCMS.
 *
 * Version-related data types for version history, diff comparison, and rollback.
 */

/**
 * A version snapshot of an entry at a specific point in time.
 */
export const entryVersion = type({
  id,
  entryId: id,
  version: 'number.integer >= 1',
  data: 'Record<string, unknown> | null',
  createdBy: type('string | null'),
  createdAt: timestamp,
})

export type EntryVersion = typeof entryVersion.infer

/**
 * Diff action type.
 */
export const diffAction = type("'add' | 'update' | 'remove'")

export type DiffAction = typeof diffAction.infer

/**
 * A single field-level diff entry between two versions.
 */
export const versionDiffEntry = type({
  field: 'string',
  before: 'unknown',
  after: 'unknown',
  action: diffAction,
})

export type VersionDiffEntry = typeof versionDiffEntry.infer

/**
 * Paginated list of versions.
 */
export const versionListResponse = type({
  versions: entryVersion.array(),
  total: 'number.integer >= 0',
  page: 'number.integer >= 1',
  perPage: 'number.integer >= 1',
})

export type VersionListResponse = typeof versionListResponse.infer

/**
 * Response for rollback operation.
 */
export const rollbackResponse = type({
  entry: 'Record<string, unknown>',
  newVersion: entryVersion,
  message: 'string',
})

export type RollbackResponse = typeof rollbackResponse.infer
