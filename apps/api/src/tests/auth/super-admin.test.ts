import { describe, expect, it } from 'bun:test'
import { hasSuperAdminRole, isSuperAdminEmail, parseSuperAdminEmails } from '@/auth/super-admin'

describe('super-admin helpers', () => {
  it('parses configured emails with trimming and normalization', () => {
    expect(
      parseSuperAdminEmails(' Admin@Example.com, owner@example.com , ,ADMIN@example.com ')
    ).toEqual(['admin@example.com', 'owner@example.com'])
  })

  it('matches super-admin email case-insensitively', () => {
    const configured = parseSuperAdminEmails('admin@example.com,owner@example.com')
    expect(isSuperAdminEmail('ADMIN@example.com', configured)).toBe(true)
    expect(isSuperAdminEmail('user@example.com', configured)).toBe(false)
  })

  it('accepts super-admin role variants', () => {
    expect(hasSuperAdminRole('super-admin')).toBe(true)
    expect(hasSuperAdminRole('super_admin')).toBe(true)
    expect(hasSuperAdminRole('super admin')).toBe(true)
    expect(hasSuperAdminRole('admin')).toBe(false)
  })
})
