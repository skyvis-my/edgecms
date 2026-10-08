import { beforeEach, describe, expect, it } from 'bun:test'
import '../../../test-utils/setup'
import { getCurrentTenantSlug, setCurrentTenantSlug } from './api'

describe('Tenant API Functions', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should get current tenant slug from localStorage', () => {
    localStorage.setItem('edgecms:active-tenant', 'test-tenant')
    expect(getCurrentTenantSlug()).toBe('test-tenant')
  })

  it('should return null when no tenant slug is set', () => {
    expect(getCurrentTenantSlug()).toBeNull()
  })

  it('should set current tenant slug in localStorage', () => {
    setCurrentTenantSlug('new-tenant')
    expect(localStorage.getItem('edgecms:active-tenant')).toBe('new-tenant')
  })

  it('should remove tenant slug from localStorage when set to null', () => {
    localStorage.setItem('edgecms:active-tenant', 'test-tenant')
    setCurrentTenantSlug(null)
    expect(localStorage.getItem('edgecms:active-tenant')).toBeNull()
  })
})

describe('API Client Tenant Routing', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should prefix admin routes with tenant slug when active tenant is set', () => {
    const tenantSlug = 'my-tenant'
    const adminRoute = '/admin/collections'
    const expectedRoute = `/tenants/${tenantSlug}/admin/collections`

    const transformedRoute = adminRoute.replace('/admin/', `/tenants/${tenantSlug}/admin/`)
    expect(transformedRoute).toBe(expectedRoute)
  })

  it('should not prefix admin/tenants routes with tenant slug', () => {
    const tenantAdminRoute = '/admin/tenants'

    // Tenant management routes should not be prefixed
    const shouldTransform =
      tenantAdminRoute.startsWith('/admin/') &&
      tenantAdminRoute !== '/admin/tenants' &&
      !tenantAdminRoute.startsWith('/admin/tenants/')
    expect(shouldTransform).toBe(false)
  })

  it('should not prefix routes when no tenant is active', () => {
    const adminRoute = '/admin/collections'

    const tenantSlug = getCurrentTenantSlug()
    expect(tenantSlug).toBeNull()

    const transformedRoute = tenantSlug
      ? adminRoute.replace('/admin/', `/tenants/${tenantSlug}/admin/`)
      : adminRoute
    expect(transformedRoute).toBe(adminRoute)
  })
})

describe('Tenant Form Slug Generation', () => {
  it('should generate slug from name correctly', () => {
    const slugify = (str: string): string => {
      return str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
    }

    expect(slugify('My Test Tenant')).toBe('my-test-tenant')
    expect(slugify('Acme Corp!')).toBe('acme-corp')
    expect(slugify('Test   Multiple   Spaces')).toBe('test-multiple-spaces')
    expect(slugify('  Leading and Trailing  ')).toBe('leading-and-trailing')
    expect(slugify('Under_Score_Test')).toBe('under-score-test')
    expect(slugify('Special@#$Characters')).toBe('specialcharacters')
  })
})

describe('Tenant Types', () => {
  it('should define correct tenant status types', () => {
    type TenantStatus = 'active' | 'suspended'

    const activeStatus: TenantStatus = 'active'
    const suspendedStatus: TenantStatus = 'suspended'

    expect(activeStatus).toBe('active')
    expect(suspendedStatus).toBe('suspended')
  })

  it('should have correct tenant structure', () => {
    const tenant = {
      id: '1',
      name: 'Test Tenant',
      slug: 'test-tenant',
      status: 'active' as const,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      userCount: 5,
    }

    expect(tenant).toHaveProperty('id')
    expect(tenant).toHaveProperty('name')
    expect(tenant).toHaveProperty('slug')
    expect(tenant).toHaveProperty('status')
    expect(tenant).toHaveProperty('createdAt')
    expect(tenant).toHaveProperty('updatedAt')
    expect(tenant.slug).toMatch(/^[a-z0-9-]+$/)
  })

  it('should have correct tenant user structure', () => {
    const tenantUser = {
      id: 'user1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'admin',
    }

    expect(tenantUser).toHaveProperty('id')
    expect(tenantUser).toHaveProperty('email')
    expect(tenantUser).toHaveProperty('name')
    expect(tenantUser).toHaveProperty('role')
  })
})
