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
