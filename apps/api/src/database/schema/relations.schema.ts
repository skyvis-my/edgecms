import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
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
    /** Tenant scope owning this relation (denormalized from source collection). */
    tenantId: text('tenantId').notNull().default('global'),
    /** ISO 8601 timestamp. */
    createdAt: text('createdAt').notNull(),
    /** ISO 8601 timestamp. */
    updatedAt: text('updatedAt').notNull(),
  },
  (table) => [
    // Primary lookup: find relations for a source entry + field, ordered by sortOrder
    index('relations_source_field_idx').on(table.sourceEntryId, table.fieldName, table.sortOrder),
    // Reverse lookup: find what entries reference a target entry
    index('relations_target_idx').on(table.targetEntryId),
    // Prevent full table scans on collection cascade deletes
    index('relations_source_collection_idx').on(table.sourceCollectionId),
    index('relations_target_collection_idx').on(table.targetCollectionId),
    // Prevent duplicate links between the same source, target, and field
    uniqueIndex('relations_source_target_field_unique').on(
      table.sourceEntryId,
      table.targetEntryId,
      table.fieldName
    ),
    // ATM-05: serialize concurrent one-to-one linkers at the DB layer.
    // Partial unique index — one-to-many / many-to-many rows are unaffected.
    uniqueIndex('relations_one_to_one_unique')
      .on(table.sourceEntryId, table.fieldName)
      .where(sql`${table.relationType} = 'one-to-one'`),
    // Tenant-scoped lookup: find relations for a tenant + source entry
    index('relations_tenant_source_idx').on(table.tenantId, table.sourceEntryId),
  ]
)
