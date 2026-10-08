import type { Database } from '@/database/db'
import { usersRepository } from './users.repository'

export type AdminUser = {
  id: string
  firstName: string
  lastName: string
  username: string
  email: string
  phoneNumber: string
  status: 'active' | 'inactive' | 'invited' | 'suspended'
  role: 'superadmin' | 'admin' | 'editor' | 'viewer'
  createdAt: string
  updatedAt: string
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) {
    return { firstName: parts[0] ?? '', lastName: '' }
  }

  const [firstName, ...rest] = parts
  return {
    firstName: firstName ?? '',
    lastName: rest.join(' '),
  }
}

function toIsoDate(value: Date | string | number | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'number') {
    return new Date(value).toISOString()
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString()
    }
  }
  return new Date(0).toISOString()
}

function mapRole(rawRole: string | null | undefined, isSuperAdmin: boolean): AdminUser['role'] {
  if (isSuperAdmin) return 'superadmin'
  if (!rawRole) return 'viewer'

  const normalizedRole = rawRole.trim().toLowerCase()
  if (normalizedRole === 'owner' || normalizedRole === 'admin') return 'admin'
  if (normalizedRole === 'member' || normalizedRole === 'editor') return 'editor'
  if (normalizedRole === 'superadmin') return 'superadmin'
  return 'viewer'
}

function resolveAdminUserRole(
  globalRole: string | null | undefined,
  tenantRole: string | null | undefined
): string | null | undefined {
  return globalRole ?? tenantRole
}

export const usersService = {
  async findAdminUsers(
    db: Database,
    options: { tenantId?: string; superAdminEmails: string[] }
  ): Promise<AdminUser[]> {
    const rows = await usersRepository.findForAdminListing(db, options.tenantId)
    const seen = new Set<string>()
    const users: AdminUser[] = []

    for (const row of rows) {
      if (seen.has(row.id)) continue
      seen.add(row.id)

      const { firstName, lastName } = splitName(row.name)
      const isSuperAdmin = options.superAdminEmails.includes(row.email.toLowerCase())
      const username = row.email.includes('@') ? (row.email.split('@')[0] ?? row.email) : row.email

      users.push({
        id: row.id,
        firstName,
        lastName,
        username,
        email: row.email,
        phoneNumber: '',
        status: 'active',
        role: mapRole(resolveAdminUserRole(row.globalRole, row.tenantRole), isSuperAdmin),
        createdAt: toIsoDate(row.createdAt),
        updatedAt: toIsoDate(row.updatedAt),
      })
    }

    return users
  },
}
