import { Crown, Eye, FileText, KeyRound, Shield, UserCheck, Users } from 'lucide-react'
import type { UserStatus } from './schema'

export const callTypes = new Map<UserStatus, string>([
  ['active', 'bg-teal-100/30 text-teal-900 dark:text-teal-200 border-teal-200'],
  ['inactive', 'bg-neutral-300/40 border-neutral-300'],
  ['invited', 'bg-sky-200/40 text-sky-900 dark:text-sky-100 border-sky-300'],
  [
    'suspended',
    'bg-destructive/10 dark:bg-destructive/50 text-destructive dark:text-primary border-destructive/10',
  ],
])

export const roles = [
  {
    label: 'Superadmin',
    value: 'superadmin',
    icon: Shield,
  },
  {
    label: 'Admin',
    value: 'admin',
    icon: UserCheck,
  },
  {
    label: 'Editor',
    value: 'editor',
    icon: FileText,
  },
  {
    label: 'Viewer',
    value: 'viewer',
    icon: Eye,
  },
] as const

export type UserRoleOption = (typeof roles)[number]

export const tenantScopedRoles = [
  {
    label: 'Admin',
    value: 'admin',
    icon: UserCheck,
  },
  {
    label: 'Editor',
    value: 'editor',
    icon: FileText,
  },
  {
    label: 'Viewer',
    value: 'viewer',
    icon: Eye,
  },
] as const

/**
 * PL-03: built-in roles a tenant member can hold (`tenant_users.role`).
 * Custom roles of the tenant are listed after these.
 */
export const tenantMemberBuiltInRoles = [
  { label: 'Owner', value: 'owner', icon: Crown },
  { label: 'Admin', value: 'admin', icon: UserCheck },
  { label: 'Editor', value: 'editor', icon: FileText },
  { label: 'Member', value: 'member', icon: Users },
  { label: 'Viewer', value: 'viewer', icon: Eye },
] as const

export const customRoleIcon = KeyRound

const BUILT_IN_TENANT_ROLE_VALUES = new Set<string>(tenantMemberBuiltInRoles.map((r) => r.value))

export function isBuiltInTenantRole(role: string): boolean {
  return BUILT_IN_TENANT_ROLE_VALUES.has(role)
}

/** Built-in tenant roles plus the tenant's custom roles, labelled for a picker. */
export function buildTenantRoleOptions(roleNames: readonly string[]): Array<{ label: string; value: string }> {
  const custom = roleNames
    .filter((name) => !isBuiltInTenantRole(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ label: `${name} (custom)`, value: name }))
  return [...tenantMemberBuiltInRoles.map(({ label, value }) => ({ label, value })), ...custom]
}
