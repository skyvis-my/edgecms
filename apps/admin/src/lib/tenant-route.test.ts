import { describe, expect, it } from 'bun:test'
import {
  buildTenantAdminUrl,
  buildTenantRedirectUrl,
  requireActiveTenantSlug,
  resolveTenantSlugFromPathname,
} from './tenant-route'

describe('requireActiveTenantSlug', () => {
  it('returns tenant slug when available on canonical tenant URL', () => {
    localStorage.setItem('edgecms:active-tenant', 'acme')
    expect(requireActiveTenantSlug('/tenants/acme/collections')).toBe('acme')
  })

  it('prefers tenant slug from URL over localStorage when both are present', () => {
    localStorage.setItem('edgecms:active-tenant', 'acme')

    const slug = requireActiveTenantSlug('http://localhost:5173/tenants/umbrella/collections')

    expect(slug).toBe('umbrella')
    expect(localStorage.getItem('edgecms:active-tenant')).toBe('umbrella')
  })

  it('resolves tenant slug from /tenants/:slug path when active tenant is missing', () => {
    localStorage.removeItem('edgecms:active-tenant')

    const slug = requireActiveTenantSlug('http://localhost:5173/tenants/acme')

    expect(slug).toBe('acme')
    expect(localStorage.getItem('edgecms:active-tenant')).toBe('acme')
  })

  it('does not treat /admin/tenants/:slug as active tenant context', () => {
    localStorage.removeItem('edgecms:active-tenant')

    try {
      requireActiveTenantSlug('http://localhost:5173/admin/tenants/acme')
      expect.unreachable('expected requireActiveTenantSlug to throw redirect response')
    } catch (error) {
      expect(error).toBeInstanceOf(Response)
      expect((error as Response).status).toBe(307)
    }
  })

  it('throws redirect to tenant management when tenant is missing', () => {
    localStorage.removeItem('edgecms:active-tenant')

    try {
      requireActiveTenantSlug('/collections')
      expect.unreachable('expected requireActiveTenantSlug to throw redirect response')
    } catch (error) {
      expect(error).toBeInstanceOf(Response)
      expect((error as Response).status).toBe(307)
    }
  })

  it('redirects bare workspace paths to tenant-prefixed URL when tenant is available', () => {
    localStorage.setItem('edgecms:active-tenant', 'acme')

    try {
      requireActiveTenantSlug('http://localhost:5173/collections/c1/entries?page=2')
      expect.unreachable('expected requireActiveTenantSlug to throw redirect response')
    } catch (error) {
      expect(error).toBeInstanceOf(Response)
      expect((error as Response).status).toBe(307)
    }
  })

  it('does not redirect global /admin routes when tenant is available', () => {
    localStorage.setItem('edgecms:active-tenant', 'acme')
    expect(requireActiveTenantSlug('http://localhost:5173/admin/tenants')).toBe('acme')
  })
})

describe('buildTenantRedirectUrl', () => {
  it('prefixes tenant slug to URL path', () => {
    expect(buildTenantRedirectUrl('/collections', 'acme')).toBe('/tenants/acme/collections')
  })

  it('preserves existing query parameters while prefixing tenant path', () => {
    expect(buildTenantRedirectUrl('/collections?page=2', 'acme')).toBe(
      '/tenants/acme/collections?page=2'
    )
  })

  it('replaces existing tenant slug instead of nesting tenant segments', () => {
    expect(buildTenantRedirectUrl('/tenants/umbrella/collections?page=2', 'acme')).toBe(
      '/tenants/acme/collections?page=2'
    )
  })

  it('maps tenant root to the new tenant root', () => {
    expect(buildTenantRedirectUrl('/tenants/umbrella', 'acme')).toBe('/tenants/acme/')
  })
})

describe('buildTenantAdminUrl', () => {
  it('builds tenant workspace URL', () => {
    expect(buildTenantAdminUrl('acme')).toBe('/tenants/acme/collections')
  })
})

describe('resolveTenantSlugFromPathname', () => {
  it('extracts tenant slug from canonical tenant pathname', () => {
    expect(resolveTenantSlugFromPathname('/tenants/acme/collections')).toBe('acme')
  })

  it('returns null for non-tenant pathname', () => {
    expect(resolveTenantSlugFromPathname('/admin/tenants')).toBeNull()
  })
})
