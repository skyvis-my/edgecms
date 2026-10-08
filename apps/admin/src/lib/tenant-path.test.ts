import { describe, expect, it } from 'bun:test'
import { prefixTenantPath } from './tenant-path'

describe('prefixTenantPath', () => {
  describe('when tenantSlug is provided', () => {
    it('prefixes tenant for admin routes', () => {
      expect(prefixTenantPath('/admin/collections', 'acme')).toBe('/tenants/acme/admin/collections')
    })

    it('prefixes tenant for nested admin routes', () => {
      expect(prefixTenantPath('/admin/collections/123/entries', 'acme')).toBe(
        '/tenants/acme/admin/collections/123/entries'
      )
    })

    it('does not prefix tenant management route (exact match)', () => {
      expect(prefixTenantPath('/admin/tenants', 'acme')).toBe('/admin/tenants')
    })

    it('does not prefix tenant management sub-routes', () => {
      expect(prefixTenantPath('/admin/tenants/acme', 'acme')).toBe('/admin/tenants/acme')
    })

    it('does not prefix tenant management users route', () => {
      expect(prefixTenantPath('/admin/tenants/acme/users', 'acme')).toBe(
        '/admin/tenants/acme/users'
      )
    })

    it('does prefix routes that start with /admin/tenants- (not a tenant management route)', () => {
      // A hypothetical route like /admin/tenants-settings should be prefixed
      expect(prefixTenantPath('/admin/tenants-settings', 'acme')).toBe(
        '/tenants/acme/admin/tenants-settings'
      )
    })

    it('does not prefix non-admin routes', () => {
      expect(prefixTenantPath('/auth/login', 'acme')).toBe('/auth/login')
    })

    it('does not prefix public routes', () => {
      expect(prefixTenantPath('/public/collections', 'acme')).toBe('/public/collections')
    })

    it('does not prefix root path', () => {
      expect(prefixTenantPath('/', 'acme')).toBe('/')
    })
  })

  describe('when tenantSlug is null', () => {
    it('returns path unchanged for admin routes', () => {
      expect(prefixTenantPath('/admin/collections', null)).toBe('/admin/collections')
    })

    it('returns path unchanged for any route', () => {
      expect(prefixTenantPath('/auth/login', null)).toBe('/auth/login')
    })
  })

  describe('when tenantSlug is empty string', () => {
    it('returns path unchanged since empty string is falsy', () => {
      expect(prefixTenantPath('/admin/collections', '')).toBe('/admin/collections')
    })
  })
})
