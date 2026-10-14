import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('global'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    blurhash: text('blurhash'),
    createdBy: text('created_by'),
    originalKey: text('original_key').notNull(),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('assets_tenant_deleted_created_at_idx').on(table.tenantId, table.deletedAt, table.createdAt),
    index('assets_tenant_deleted_filename_idx').on(table.tenantId, table.deletedAt, table.filename),
    index('assets_tenant_deleted_mimetype_idx').on(table.tenantId, table.deletedAt, table.mimeType),
  ]
)

export const assetVariants = sqliteTable(
  'asset_variants',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    variant: text('variant').notNull(),
    format: text('format').notNull(),
    width: integer('width'),
    height: integer('height'),
    fileSize: integer('file_size'),
    objectKey: text('object_key').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('asset_variants_asset_id_idx').on(table.assetId),
    uniqueIndex('asset_variants_asset_variant_format_unique').on(
      table.assetId,
      table.variant,
      table.format
    ),
  ]
)

/**
 * R2 GC outbox — durable intent log for R2 object deletes.
 *
 * hardDelete removes D1 rows first, then enqueues one row per object key
 * here BEFORE attempting the R2 deletes. Each key is marked sent after a
 * successful r2.delete, or left pending with a backoff for the sweeper
 * (see sweepR2GcOutbox, invoked by gcSoftDeleted / POST /gc). R2 deletes
 * are idempotent, so crash-replayed rows are safe. objectKey is UNIQUE so
 * double-enqueue collapses.
 */
export const r2GcOutbox = sqliteTable(
  'r2_gc_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('global'),
    objectKey: text('object_key').notNull().unique(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('r2_gc_outbox_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
  ]
)
