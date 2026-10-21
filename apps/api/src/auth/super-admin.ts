function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function parseSuperAdminEmails(raw: string | undefined): string[] {
  if (!raw) return []
  return [...new Set(raw.split(',').map(normalizeEmail).filter(Boolean))]
}

/** True when `email` is listed in SUPER_ADMIN_EMAILS (ignores verification). */
export function isListedSuperAdminEmail(
  email: string | null | undefined,
  configured: string[]
): boolean {
  if (!email) return false
  return configured.includes(normalizeEmail(email))
}

/**
 * Super-admin by email: the address is listed in SUPER_ADMIN_EMAILS *and*
 * verified. An unverified listed address grants nothing, otherwise anyone
 * could register it and become super-admin.
 */
export function isSuperAdminEmail(
  email: string | null | undefined,
  configured: string[],
  emailVerified: boolean | null | undefined
): boolean {
  return emailVerified === true && isListedSuperAdminEmail(email, configured)
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
 * Whether `user` has super-admin access: the `superadmin` role, a verified
 * email in SUPER_ADMIN_EMAILS, or SUPER_ADMIN_DEV_MODE=true when no emails are set.
 */
export function isSuperAdminUser(
  user: { email?: string | null; emailVerified?: boolean | null; role?: unknown } | undefined,
  config: { SUPER_ADMIN_EMAILS?: string; SUPER_ADMIN_DEV_MODE?: string }
): boolean {
  if (!user) return false
  if (hasSuperAdminRole(user.role)) return true
  const emails = parseSuperAdminEmails(config.SUPER_ADMIN_EMAILS)
  if (emails.length === 0) return config.SUPER_ADMIN_DEV_MODE === 'true'
  return isSuperAdminEmail(user.email, emails, user.emailVerified)
}
