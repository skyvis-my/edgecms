import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Cache tags table — maps cache tags to snapshot keys for cache invalidation.
 *
 * This table enables tag-based cache invalidation. When content changes,
 * all snapshots associated with a tag (e.g., 'collection:articles', 'entry:abc123')
 * can be identified and invalidated from KV storage.
 *
 * A single snapshot may have multiple tags (e.g., a list snapshot has both
 * collection and locale tags).
 */
export const cacheTags = sqliteTable(
  'cache_tags',
  {
    /** UUID primary key. */
    id: text('id').primaryKey(),
    /**
     * Tag string used for cache invalidation.
     * Examples: 'collection:articles', 'entry:abc123', 'locale:en'
     */
    tag: text('tag').notNull(),
    /**
     * KV key of the snapshot this tag is associated with.
     * Example: 'snapshot:articles:en:list'
     */
    snapshotKey: text('snapshotKey').notNull(),
    /** ISO 8601 timestamp. */
    createdAt: text('createdAt').notNull(),
  },
  (table) => [
    // Index for finding all snapshots with a given tag (for invalidation)
    index('cache_tags_tag_idx').on(table.tag),
    // Index for finding all tags associated with a snapshot key (for updates)
    index('cache_tags_snapshot_key_idx').on(table.snapshotKey),
  ]
)
