export function hasGlobalAdminAccess(role: unknown): boolean {
  if (typeof role !== 'string') return false

  const normalizedRole = role
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')

  return normalizedRole === 'admin' || normalizedRole === 'superadmin'
}
