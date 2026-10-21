import { describe, expect, it } from 'bun:test'
import {
  hasSuperAdminRole,
  isSuperAdminEmail,
  isSuperAdminUser,
  parseSuperAdminEmails,
} from '@/auth/super-admin'

describe('super-admin helpers', () => {
  it('parses configured emails with trimming and normalization', () => {
    expect(
      parseSuperAdminEmails(' Admin@Example.com, owner@example.com , ,ADMIN@example.com ')
    ).toEqual(['admin@example.com', 'owner@example.com'])
  })

  it('matches super-admin email case-insensitively', () => {
    const configured = parseSuperAdminEmails('admin@example.com,owner@example.com')
    expect(isSuperAdminEmail('ADMIN@example.com', configured, true)).toBe(true)
    expect(isSuperAdminEmail('user@example.com', configured, true)).toBe(false)
  })

  it('never grants super-admin to an unverified listed email', () => {
    const configured = parseSuperAdminEmails('admin@example.com')
    expect(isSuperAdminEmail('admin@example.com', configured, false)).toBe(false)
    expect(isSuperAdminEmail('admin@example.com', configured, undefined)).toBe(false)
    const env = { SUPER_ADMIN_EMAILS: 'admin@example.com' }
    expect(isSuperAdminUser({ email: 'admin@example.com', emailVerified: false }, env)).toBe(false)
    expect(isSuperAdminUser({ email: 'admin@example.com', emailVerified: true }, env)).toBe(true)
    // The superadmin role is assigned by admins, not self-asserted, so it needs no email check.
    expect(isSuperAdminUser({ email: 'x@example.com', role: 'superadmin' }, env)).toBe(true)
  })

  it('accepts super-admin role variants', () => {
    expect(hasSuperAdminRole('super-admin')).toBe(true)
    expect(hasSuperAdminRole('super_admin')).toBe(true)
    expect(hasSuperAdminRole('super admin')).toBe(true)
    expect(hasSuperAdminRole('admin')).toBe(false)
  })
})
