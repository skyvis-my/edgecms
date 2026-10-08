import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { collections } from '@/database/schema/collections.schema'
import { entries } from '@/database/schema/entries.schema'

/**
 * Relations table — manages relationships between entries.
 *
 * Each relation record represents a link from a source entry to a target entry
 * through a specific field. Relations support one-to-one, one-to-many, and
 * many-to-many cardinalities, with sort ordering for ordered relations.
 *
 * Cascade deletes ensure referential integrity when entries or collections are removed.
 */
export const relations = sqliteTable(
  'relations',
  {
    id: text('id').primaryKey(),
    /** Source entry that owns this relation. */
    sourceEntryId: text('sourceEntryId')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    /** Target entry being referenced. */
    targetEntryId: text('targetEntryId')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    /** Collection ID of the source entry (denormalized for querying). */
    sourceCollectionId: text('sourceCollectionId')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    /** Collection ID of the target entry (denormalized for querying). */
    targetCollectionId: text('targetCollectionId')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    /** Relation cardinality: 'one-to-one', 'one-to-many', or 'many-to-many'. */
    relationType: text('relationType').notNull(),
    /** Field name on the source entry that defines this relation. */
    fieldName: text('fieldName').notNull(),
    /** Sort order for ordered relations (default 0). */
    sortOrder: integer('sortOrder').notNull().default(0),
    /** ISO 8601 timestamp. */
    createdAt: text('createdAt').notNull(),
    /** ISO 8601 timestamp. */
    updatedAt: text('updatedAt').notNull(),
  },
  (table) => [
    // Primary lookup: find relations for a source entry + field
    index('relations_source_field_idx').on(table.sourceEntryId, table.fieldName),
    // Reverse lookup: find what entries reference a target entry
    index('relations_target_idx').on(table.targetEntryId),
    // Prevent duplicate links between the same source, target, and field
    uniqueIndex('relations_source_target_field_unique').on(
      table.sourceEntryId,
      table.targetEntryId,
      table.fieldName
    ),
  ]
)
