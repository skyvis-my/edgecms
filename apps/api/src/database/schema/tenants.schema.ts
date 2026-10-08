import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { user } from './auth.schema'

/**
 * Tenant registry tables for multi-tenant architecture.
 *
 * Each tenant has its own isolated D1/KV/R2 resources and user access list.
 * Tenants are identified by a unique slug for URL routing.
 */

/** Tenants table — stores tenant metadata and status. */
export const tenants = sqliteTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    localeCatalog: text('localeCatalog', { mode: 'json' }).notNull().$type<string[]>(),
    targetUrl: text('targetUrl'),
    corsOrigin: text('corsOrigin'),
    mediaUploadMaxBytes: integer('mediaUploadMaxBytes').notNull().default(5 * 1024 * 1024),
    mediaUploadMaxDimension: integer('mediaUploadMaxDimension').notNull().default(2048),
    mediaAllowedMimeTypes: text('mediaAllowedMimeTypes', { mode: 'json' })
      .notNull()
      .$type<string[]>(),
    /** ISO 8601 timestamp. */
    createdAt: text('createdAt').notNull(),
    /** ISO 8601 timestamp. */
    updatedAt: text('updatedAt').notNull(),
  },
  (table) => [uniqueIndex('tenants_slug_unique').on(table.slug)]
)

/** Tenant users table — many-to-many mapping between tenants and users with roles. */
export const tenantUsers = sqliteTable(
  'tenant_users',
  {
    tenantId: text('tenantId')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    /** ISO 8601 timestamp. */
    createdAt: text('createdAt').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    index('tenant_users_user_id_idx').on(table.userId),
  ]
)

/** Tenant resources table — stores Cloudflare resource IDs for each tenant. */
export const tenantResources = sqliteTable('tenant_resources', {
  tenantId: text('tenantId')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  d1DatabaseId: text('d1DatabaseId'),
  kvNamespaceId: text('kvNamespaceId'),
  r2BucketName: text('r2BucketName'),
  /** ISO 8601 timestamp. */
  createdAt: text('createdAt').notNull(),
  /** ISO 8601 timestamp. */
  updatedAt: text('updatedAt').notNull(),
})
