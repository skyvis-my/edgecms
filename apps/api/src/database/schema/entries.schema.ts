import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { collections } from './collections.schema'

/**
 * Entries table — individual content records within a collection.
 *
 * Each entry belongs to a collection, carries a publication status,
 * stores its field data as serialised JSON, and tracks a version number
 * for optimistic concurrency control.
 */
export const entries = sqliteTable(
  'entries',
  {
    id: text('id').primaryKey(),
    collectionId: text('collectionId')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    /** One of: draft, scheduled, published, archived. */
    status: text('status').notNull().default('draft'),
    /** JSON-serialised entry field values. Localizable fields use { locale: value } structure. */
    data: text('data', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    version: integer('version').notNull().default(1),
    /** ISO 8601 timestamp. */
    createdAt: text('createdAt').notNull(),
    /** ISO 8601 timestamp. */
    updatedAt: text('updatedAt').notNull(),
    /** ISO 8601 timestamp for scheduled publish. */
    publishAt: text('publish_at'),
    /** ISO 8601 timestamp for scheduled unpublish. */
    unpublishAt: text('unpublish_at'),
  },
  (table) => [
    uniqueIndex('entries_collection_slug_unique').on(table.collectionId, table.slug),
    index('entries_collectionId_idx').on(table.collectionId),
    index('entries_status_idx').on(table.status),
  ]
)

/**
 * Entry versions table — immutable snapshots of entry data at each version.
 *
 * Every time an entry is updated, a version record is created to preserve
 * the previous state. This enables version history, rollback, and audit trails.
 */
export const entryVersions = sqliteTable(
  'entry_versions',
  {
    id: text('id').primaryKey(),
    entryId: text('entryId')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** JSON snapshot of the entry data at this version. */
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
    /** User ID who created this version. */
    createdBy: text('createdBy'),
    /** ISO 8601 timestamp. */
    createdAt: text('createdAt').notNull(),
  },
  (table) => [
    uniqueIndex('entry_versions_entry_version_unique').on(table.entryId, table.version),
    index('entry_versions_entryId_idx').on(table.entryId),
  ]
)
