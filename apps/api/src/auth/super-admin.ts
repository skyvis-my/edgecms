function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function parseSuperAdminEmails(raw: string | undefined): string[] {
  if (!raw) return []
  return [...new Set(raw.split(',').map(normalizeEmail).filter(Boolean))]
}

export function isSuperAdminEmail(email: string | null | undefined, configured: string[]): boolean {
  if (!email) return false
  return configured.includes(normalizeEmail(email))
}

export function hasSuperAdminRole(role: unknown): boolean {
  if (typeof role !== 'string') return false
  const normalizedRole = role
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
  return normalizedRole === 'superadmin'
}

/**
 * Whether `user` has super-admin access: the `superadmin` role, an email in
 * SUPER_ADMIN_EMAILS, or SUPER_ADMIN_DEV_MODE=true when no emails are set.
 */
export function isSuperAdminUser(
  user: { email?: string | null; role?: unknown } | undefined,
  config: { SUPER_ADMIN_EMAILS?: string; SUPER_ADMIN_DEV_MODE?: string }
): boolean {
  if (!user) return false
  if (hasSuperAdminRole(user.role)) return true
  const emails = parseSuperAdminEmails(config.SUPER_ADMIN_EMAILS)
  if (emails.length === 0) return config.SUPER_ADMIN_DEV_MODE === 'true'
  return isSuperAdminEmail(user.email, emails)
}
