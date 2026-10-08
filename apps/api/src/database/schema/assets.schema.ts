import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
    index('assets_tenant_id_idx').on(table.tenantId),
    index('assets_tenant_created_at_idx').on(table.tenantId, table.createdAt),
    index('assets_tenant_deleted_created_at_idx').on(table.tenantId, table.deletedAt, table.createdAt),
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
  (table) => [index('asset_variants_asset_id_idx').on(table.assetId)]
)
