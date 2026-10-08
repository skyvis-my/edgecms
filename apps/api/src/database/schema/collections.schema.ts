import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Collections table — defines content types (collections) in the CMS.
 *
 * A collection is the CMS equivalent of a content type or model.
 * Each collection has a set of field definitions that describe the shape
 * of its entries, plus locale configuration for i18n support.
 *
 * JSON columns (fields, supportedLocales) are stored as serialised text
 * because D1/SQLite does not have a native JSON column type.
 */
export const collections = sqliteTable(
  'collections',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenantId').notNull().default('global'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    singleton: integer('singleton', { mode: 'boolean' }).notNull().default(false),
    /** JSON-serialised array of FieldDefinition objects. */
    fields: text('fields', { mode: 'json' }).notNull().$type<
      Array<{
        name: string
        type: string
        required: boolean
        localizable: boolean
        options?: Record<string, unknown>
      }>
    >(),
    defaultLocale: text('defaultLocale').notNull().default('en'),
    /** JSON-serialised array of BCP 47 locale codes. */
    supportedLocales: text('supportedLocales', { mode: 'json' }).notNull().$type<string[]>(),
    /** ISO 8601 timestamp. */
    createdAt: text('createdAt').notNull(),
    /** ISO 8601 timestamp. */
    updatedAt: text('updatedAt').notNull(),
    /** Display metadata */
    displayName: text('displayName'),
    description: text('description'),
    icon: text('icon'),
    color: text('color'),
    /** JSON-serialised array of field names for list view. */
    listFields: text('listFields', { mode: 'json' }).$type<string[]>(),
    /** JSON-serialised array of field names for search. */
    searchFields: text('searchFields', { mode: 'json' }).$type<string[]>(),
    defaultSort: text('defaultSort'),
    defaultSortOrder: text('defaultSortOrder'),
  },
  (table) => [
    uniqueIndex('collections_tenant_slug_unique').on(table.tenantId, table.slug),
    index('collections_tenantId_idx').on(table.tenantId),
  ]
)
