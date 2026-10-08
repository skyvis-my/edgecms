import { describe, expect, it } from 'bun:test'
import { Route as TenantParentRoute } from '@/routes/_authenticated/tenants/$tenantSlug'

describe('tenant parent route redirect behavior', () => {
  it('does not redirect when navigating to a tenant child route', () => {
    const beforeLoad = TenantParentRoute.options.beforeLoad
    if (!beforeLoad) {
      expect.unreachable('tenant parent route beforeLoad must be defined')
    }

    expect(() =>
      beforeLoad({
        params: { tenantSlug: 'acme' },
        location: { pathname: '/tenants/acme/collections' },
      } as never)
    ).not.toThrow()
  })

  it('redirects to collections when opening tenant root route', () => {
    const beforeLoad = TenantParentRoute.options.beforeLoad
    if (!beforeLoad) {
      expect.unreachable('tenant parent route beforeLoad must be defined')
    }

    expect(() =>
      beforeLoad({
        params: { tenantSlug: 'acme' },
        location: { pathname: '/tenants/acme' },
      } as never)
    ).toThrow(Response)
  })
})
