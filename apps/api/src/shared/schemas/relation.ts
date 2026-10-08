import { type } from 'arktype'
import { id, timestamp } from './common'

/**
 * Relation schemas for EdgeCMS.
 *
 * Relations represent links between entries in different collections,
 * supporting one-to-one, one-to-many, and many-to-many cardinalities.
 */

/**
 * Relation type — defines the cardinality of the relationship.
 *
 * - one-to-one:   source field can reference exactly one target entry
 * - one-to-many:  source field can reference multiple target entries
 * - many-to-many: multiple source entries can reference multiple target entries
 */
export const relationType = type("'one-to-one' | 'one-to-many' | 'many-to-many'")

export type RelationType = typeof relationType.infer

/**
 * A relation record linking two entries.
 *
 * - sourceEntryId: the entry that owns this relation
 * - targetEntryId: the entry being referenced
 * - sourceCollectionId: collection of the source entry (denormalized)
 * - targetCollectionId: collection of the target entry (denormalized)
 * - relationType: cardinality constraint
 * - fieldName: the field on the source entry that defines this relation
 * - sortOrder: ordering for relation arrays (0-based)
 */
export const relation = type({
  id,
  sourceEntryId: id,
  targetEntryId: id,
  sourceCollectionId: id,
  targetCollectionId: id,
  relationType,
  fieldName: 'string',
  sortOrder: 'number.integer >= 0',
  createdAt: timestamp,
  updatedAt: timestamp,
})

export type Relation = typeof relation.infer

/**
 * Input for linking two entries.
 */
export const linkRelationInput = type({
  sourceEntryId: id,
  targetEntryId: id,
  sourceCollectionId: id,
  targetCollectionId: id,
  relationType,
  fieldName: 'string',
  'sortOrder?': 'number.integer >= 0',
})

export type LinkRelationInput = typeof linkRelationInput.infer

/**
 * Input for unlinking two entries.
 */
export const unlinkRelationInput = type({
  sourceEntryId: id,
  targetEntryId: id,
  fieldName: 'string',
})

export type UnlinkRelationInput = typeof unlinkRelationInput.infer
