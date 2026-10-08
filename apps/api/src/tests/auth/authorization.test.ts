import { describe, expect, it } from 'bun:test'
import { authorizeApiRequest, defineAbilityForPrincipal, createAuthorizationAbility } from '../../auth/authorization'

describe('authorization abilities', () => {
  it('allows superadmin principals to manage all admin surfaces', () => {
    const byRole = createAuthorizationAbility({
      actorId: 'super-1',
      actorRole: 'viewer',
      isSuperAdmin: true,
    })
    const byEmail = createAuthorizationAbility({
      actorId: 'super-2',
      actorRole: 'viewer',
      isSuperAdminByEmail: true,
    })

    expect(byRole.can('read', 'GlobalAdminUsers')).toBe(true)
    expect(byRole.can('mutate', 'GlobalAdminApi')).toBe(true)
    expect(byRole.can('mutate', 'TenantAdminApi')).toBe(true)
    expect(byEmail.can('read', 'GlobalAdminUsers')).toBe(true)
    expect(byEmail.can('mutate', 'GlobalAdminApi')).toBe(true)
    expect(byEmail.can('mutate', 'TenantAdminApi')).toBe(true)
  })

  it('allows tenant admin mutations for tenant editor role', () => {
    const ability = defineAbilityForPrincipal({
      actorRole: 'viewer',
      tenantRole: 'editor',
    })

    expect(ability.can('mutate', 'TenantAdminApi')).toBe(true)
  })

  it('rejects global admin user listing for editor role', () => {
    const ability = defineAbilityForPrincipal({
      actorRole: 'editor',
    })

    expect(ability.can('read', 'GlobalAdminUsers')).toBe(false)
  })

  it('allows mutate TenantAdminApi with custom permission', () => {
    const ability = createAuthorizationAbility({
      actorId: 'user-1',
      actorRole: 'viewer',
      tenantRole: 'viewer',
    }, [
      { subject: 'TenantAdminApi', action: 'mutate' },
    ])

    expect(ability.can('mutate', 'TenantAdminApi')).toBe(true)
  })
})

describe('authorizeApiRequest', () => {
  it('returns unauthorized for protected path when actor is missing', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/admin/commands',
      method: 'POST',
      principal: {},
    })

    expect(decision).toEqual({
      allowed: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    })
  })

  it('allows global admin user listing for admin role', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/admin/users',
      method: 'GET',
      principal: {
        actorId: 'user-1',
        actorRole: 'admin',
      },
    })

    expect(decision).toEqual({ allowed: true })
  })

  it('forbids global admin user listing for editor role', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/admin/users',
      method: 'GET',
      principal: {
        actorId: 'user-1',
        actorRole: 'editor',
      },
    })

    expect(decision).toEqual({
      allowed: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Admin access required',
    })
  })

  it('forbids global admin reads for viewer role', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/admin/webhooks',
      method: 'GET',
      principal: {
        actorId: 'user-1',
        actorRole: 'viewer',
      },
    })

    expect(decision).toEqual({
      allowed: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Insufficient role',
    })
  })

  it('allows global admin reads for editor role', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/admin/webhooks',
      method: 'GET',
      principal: {
        actorId: 'user-1',
        actorRole: 'editor',
      },
    })

    expect(decision).toEqual({ allowed: true })
  })

  it('returns unauthorized for global admin user listing when actor is missing', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/admin/users',
      method: 'GET',
      principal: {},
    })

    expect(decision).toEqual({
      allowed: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    })
  })

  it('allows tenant admin user listing for tenant owner', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/tenants/acme/api/admin/users',
      method: 'GET',
      principal: {
        actorId: 'user-1',
        actorRole: 'viewer',
        tenantRole: 'owner',
      },
    })

    expect(decision).toEqual({ allowed: true })
  })

  it('forbids tenant admin user listing for tenant member', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/tenants/acme/api/admin/users',
      method: 'GET',
      principal: {
        actorId: 'user-1',
        actorRole: 'viewer',
        tenantRole: 'member',
      },
    })

    expect(decision).toEqual({
      allowed: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Tenant admin access required',
    })
  })

  it('forbids tenant admin user listing for tenant viewer', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/tenants/acme/api/admin/users',
      method: 'GET',
      principal: {
        actorId: 'user-1',
        actorRole: 'viewer',
        tenantRole: 'viewer',
      },
    })

    expect(decision).toEqual({
      allowed: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Tenant admin access required',
    })
  })

  it('forbids tenant admin reads for tenant viewer role', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/tenants/acme/api/admin/webhooks',
      method: 'GET',
      principal: {
        actorId: 'user-1',
        actorRole: 'viewer',
        tenantRole: 'viewer',
      },
    })

    expect(decision).toEqual({
      allowed: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Insufficient role',
    })
  })

  it('allows tenant admin API access with custom permission from database', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/tenants/acme/api/admin/collections',
      method: 'GET',
      principal: {
        actorId: 'user-1',
        actorRole: 'viewer',
        tenantRole: 'viewer',
      },
      customPermissions: [
        { subject: 'collection:*', action: 'read' },
        { subject: 'TenantAdminApi', action: 'read' },
      ],
    })

    expect(decision).toEqual({ allowed: true })
  })

  it('forbids settings access when custom permission is missing', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/tenants/acme/api/admin/settings',
      method: 'GET',
      principal: {
        actorId: 'user-1',
        actorRole: 'viewer',
        tenantRole: 'viewer',
      },
      customPermissions: [
        { subject: 'collection:blog', action: 'read' },
      ],
    })

    expect(decision).toEqual({
      allowed: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'Insufficient role',
    })
  })

  it('allows entry mutation with custom permission from database', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/tenants/acme/api/admin/entries',
      method: 'POST',
      principal: {
        actorId: 'user-1',
        actorRole: 'viewer',
        tenantRole: 'viewer',
      },
      customPermissions: [
        { subject: 'TenantAdminApi', action: 'mutate' },
      ],
    })

    expect(decision).toEqual({ allowed: true })
  })

  it('allows all collections with collection:* wildcard permission', () => {
    const decision = authorizeApiRequest({
      pathname: '/api/tenants/acme/api/admin/collections',
      method: 'GET',
      principal: {
        actorId: 'user-1',
        actorRole: 'viewer',
        tenantRole: 'viewer',
      },
      customPermissions: [
        { subject: 'collection:*', action: 'read' },
        { subject: 'TenantAdminApi', action: 'read' },
      ],
    })

    expect(decision).toEqual({ allowed: true })
  })
})
