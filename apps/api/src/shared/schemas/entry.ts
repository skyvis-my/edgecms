import { type } from 'arktype'
import { id, slug, timestamp } from './common'

/**
 * Content entry schemas for EdgeCMS.
 *
 * An "entry" is a single content record within a collection.
 * Entries go through a defined lifecycle: draft -> scheduled -> published -> archived.
 * Each entry stores its field data as a flexible key-value record and
 * tracks a version number for optimistic concurrency control.
 */

/**
 * Entry status — the publication lifecycle state.
 *
 * - draft:     work-in-progress, not publicly visible
 * - scheduled: approved content waiting for a future publish date
 * - published: live and publicly accessible via the delivery API
 * - archived:  removed from public view but retained for history
 */
export const entryStatuses = ['draft', 'scheduled', 'published', 'archived'] as const

/**
 * Statuses that are considered public lifecycle states.
 */
export const publicEntryStatuses = ['published', 'scheduled'] as const

/**
 * Command-only lifecycle states: updates should go through publish/schedule commands.
 */
export const commandLifecycleEntryStatuses = ['scheduled', 'published'] as const

export const entryStatus = type("'draft' | 'scheduled' | 'published' | 'archived'")

/**
 * Runtime type guard for entry status values.
 */
export function isEntryStatus(status: string): status is EntryStatus {
  return (entryStatuses as readonly string[]).includes(status)
}

/**
 * Runtime type guard for statuses that should not be set directly on entry update/create.
 */
export function isCommandLifecycleStatus(status: string): status is
  (typeof commandLifecycleEntryStatuses)[number] {
  return (commandLifecycleEntryStatuses as readonly string[]).includes(status)
}

export type EntryStatus = typeof entryStatus.infer

/**
 * A content entry within a collection.
 *
 * - collectionId: references the parent collection definition
 * - slug: URL-friendly identifier, unique within the collection
 * - status: current publication lifecycle state
 * - data: the actual field values, keyed by field name
 * - version: monotonically increasing version for optimistic locking
 */
export const entry = type({
  id,
  collectionId: id,
  slug,
  status: entryStatus,
  data: 'Record<string, unknown>',
  version: 'number.integer >= 1',
  createdAt: timestamp,
  updatedAt: timestamp,
})

export type Entry = typeof entry.infer
