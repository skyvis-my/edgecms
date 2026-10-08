import { describe, expect, it } from 'bun:test'
import { extractTenantSlug } from '@/tenants/tenant-path'

describe('tenant-path helpers', () => {
  it('extracts tenant slug from tenant-scoped API path', () => {
    expect(extractTenantSlug('/api/tenants/acme/admin/users')).toBe('acme')
  })

  it('returns undefined for non-tenant paths', () => {
    expect(extractTenantSlug('/api/admin/users')).toBeUndefined()
    expect(extractTenantSlug('/api/tenants/')).toBeUndefined()
  })
})
