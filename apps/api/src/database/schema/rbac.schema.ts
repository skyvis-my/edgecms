import { index, sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { tenants } from './tenants.schema'

/**
 * Roles table — stores custom roles for RBAC.
 *
 * Each role belongs to a tenant and can be assigned to users.
 * Built-in roles (viewer, editor, admin, owner) are seeded on tenant creation.
 */
export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('roles_tenant_id_idx').on(table.tenantId),
  index('roles_tenant_name_idx').on(table.tenantId, table.name),
])

/**
 * Permissions table — stores granular permissions for each role.
 *
 * Each permission grants a specific action on a subject.
 * Subjects: 'collection:*', 'collection:<slug>', 'entry:*', 'asset:*', 'user:*', 'settings:*'
 * Actions: 'create', 'read', 'update', 'delete', 'publish', 'manage'
 */
export const permissions = sqliteTable('permissions', {
  id: text('id').primaryKey(),
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  action: text('action').notNull(),
  conditions: text('conditions'), // Optional JSON for field-level restrictions (future use)
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('permissions_role_id_idx').on(table.roleId),
])
