import { describe, expect, it } from 'bun:test'
import { hasGlobalAdminAccess } from './admin-role'

describe('admin-role', () => {
  it('identifies valid global admin roles', () => {
    expect(hasGlobalAdminAccess('admin')).toBe(true)
    expect(hasGlobalAdminAccess('superadmin')).toBe(true)
    expect(hasGlobalAdminAccess('ADMIN')).toBe(true)
    expect(hasGlobalAdminAccess('SUPERADMIN')).toBe(true)
    expect(hasGlobalAdminAccess('super-admin')).toBe(true)
    expect(hasGlobalAdminAccess('super_admin')).toBe(true)
    expect(hasGlobalAdminAccess('  admin  ')).toBe(true)
  })

  it('rejects non-admin roles and invalid types', () => {
    expect(hasGlobalAdminAccess('editor')).toBe(false)
    expect(hasGlobalAdminAccess('viewer')).toBe(false)
    expect(hasGlobalAdminAccess('author')).toBe(false)
    expect(hasGlobalAdminAccess('')).toBe(false)
    expect(hasGlobalAdminAccess(null)).toBe(false)
    expect(hasGlobalAdminAccess(undefined)).toBe(false)
    expect(hasGlobalAdminAccess(123)).toBe(false)
    expect(hasGlobalAdminAccess({})).toBe(false)
  })
})
