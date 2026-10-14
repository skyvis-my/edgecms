import type { NewPermission, NewRole } from './rbac.repository'

/** Built-in role names. */
export type BuiltInRoleName = 'viewer' | 'editor' | 'admin' | 'owner'

/** Built-in permissions for each role. */
export const BUILTIN_PERMISSIONS: Record<BuiltInRoleName, Array<{ subject: string; action: string }>> = {
  viewer: [
    { subject: 'collection:*', action: 'read' },
    { subject: 'entry:*', action: 'read' },
    { subject: 'asset:*', action: 'read' },
  ],
  editor: [
    { subject: 'collection:*', action: 'read' },
    { subject: 'entry:*', action: 'read' },
    { subject: 'entry:*', action: 'create' },
    { subject: 'entry:*', action: 'update' },
    { subject: 'entry:*', action: 'delete' },
    { subject: 'entry:*', action: 'publish' },
    { subject: 'asset:*', action: 'read' },
    { subject: 'asset:*', action: 'create' },
    { subject: 'asset:*', action: 'update' },
    { subject: 'asset:*', action: 'delete' },
  ],
  admin: [
    { subject: 'collection:*', action: 'manage' },
    { subject: 'entry:*', action: 'manage' },
    { subject: 'asset:*', action: 'manage' },
    { subject: 'user:*', action: 'read' },
    { subject: 'user:*', action: 'create' },
    { subject: 'user:*', action: 'update' },
    { subject: 'settings:*', action: 'manage' },
    { subject: 'webhooks:*', action: 'manage' },
  ],
  owner: [
    { subject: '*:*', action: 'manage' },
  ],
}

/**
 * Build all role + permission rows for seeding a tenant's built-in roles.
 * IDs are pre-generated so the whole set can go into one db.batch().
 */
export function buildBuiltInSeedRows(
  tenantId: string,
  now = new Date().toISOString()
): { roleRows: NewRole[]; permRows: NewPermission[] } {
  const roleNames: BuiltInRoleName[] = ['viewer', 'editor', 'admin', 'owner']
  const roleDescriptions: Record<BuiltInRoleName, string> = {
    viewer: 'Can read content only',
    editor: 'Can create, edit, and publish content',
    admin: 'Can manage all content and users',
    owner: 'Full access to all resources',
  }
  const roleRows: NewRole[] = roleNames.map((roleName) => ({
    id: crypto.randomUUID(),
    tenantId,
    name: roleName,
    description: roleDescriptions[roleName],
    isDefault: roleName === 'viewer',
    createdAt: now,
    updatedAt: now,
  }))
  const permRows: NewPermission[] = roleRows.flatMap((role) =>
    BUILTIN_PERMISSIONS[role.name as BuiltInRoleName].map((perm) => ({
      id: crypto.randomUUID(),
      roleId: role.id,
      subject: perm.subject,
      action: perm.action,
      conditions: null,
      createdAt: now,
    }))
  )
  return { roleRows, permRows }
}
