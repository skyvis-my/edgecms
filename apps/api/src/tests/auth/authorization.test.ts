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

  it('forbids editor role from mutating roles, webhooks, or hard deleting assets', () => {
    const editorPrincipal = {
      actorId: 'user-1',
      actorRole: 'editor' as const,
      tenantRole: 'editor' as const,
    }

    // Role mutation
    const rolesDecision = authorizeApiRequest({
      pathname: '/api/admin/roles',
      method: 'POST',
      principal: editorPrincipal,
    })
    expect(rolesDecision.allowed).toBe(false)
    if (!rolesDecision.allowed) {
      expect(rolesDecision.code).toBe('FORBIDDEN')
    }

    // Tenant role mutation
    const tenantRolesDecision = authorizeApiRequest({
      pathname: '/api/tenants/acme/api/admin/roles/role-1',
      method: 'DELETE',
      principal: editorPrincipal,
    })
    expect(tenantRolesDecision.allowed).toBe(false)

    // Webhooks mutation
    const webhooksDecision = authorizeApiRequest({
      pathname: '/api/admin/webhooks',
      method: 'POST',
      principal: editorPrincipal,
    })
    expect(webhooksDecision.allowed).toBe(false)

    // Tenant webhooks mutation
    const tenantWebhooksDecision = authorizeApiRequest({
      pathname: '/api/tenants/acme/api/admin/webhooks/wh-1',
      method: 'PUT',
      principal: editorPrincipal,
    })
    expect(tenantWebhooksDecision.allowed).toBe(false)

    // Asset permanent deletion
    const permanentDeleteDecision = authorizeApiRequest({
      pathname: '/api/admin/assets/asset-1/permanent',
      method: 'DELETE',
      principal: editorPrincipal,
    })
    expect(permanentDeleteDecision.allowed).toBe(false)

    // Asset GC
    const gcDecision = authorizeApiRequest({
      pathname: '/api/admin/assets/gc',
      method: 'POST',
      principal: editorPrincipal,
    })
    expect(gcDecision.allowed).toBe(false)
  })

  it('allows admin role to mutate roles, webhooks, and hard delete assets', () => {
    const adminPrincipal = {
      actorId: 'user-admin',
      actorRole: 'admin' as const,
    }

    expect(authorizeApiRequest({
      pathname: '/api/admin/roles',
      method: 'POST',
      principal: adminPrincipal,
    })).toEqual({ allowed: true })

    expect(authorizeApiRequest({
      pathname: '/api/admin/webhooks',
      method: 'POST',
      principal: adminPrincipal,
    })).toEqual({ allowed: true })

    expect(authorizeApiRequest({
      pathname: '/api/admin/assets/asset-1/permanent',
      method: 'DELETE',
      principal: adminPrincipal,
    })).toEqual({ allowed: true })
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

  it('exempts GraphQL endpoints from admin authorization checks', () => {
    const globalGet = authorizeApiRequest({ pathname: '/api/graphql', method: 'GET', principal: {} })
    const globalPost = authorizeApiRequest({ pathname: '/api/graphql', method: 'POST', principal: {} })
    const tenantGet = authorizeApiRequest({ pathname: '/api/tenants/acme/graphql', method: 'GET', principal: {} })
    const tenantPost = authorizeApiRequest({ pathname: '/api/tenants/acme/graphql', method: 'POST', principal: {} })
    const tenantApiPost = authorizeApiRequest({ pathname: '/api/tenants/acme/api/graphql', method: 'POST', principal: {} })

    expect(globalGet).toEqual({ allowed: true })
    expect(globalPost).toEqual({ allowed: true })
    expect(tenantGet).toEqual({ allowed: true })
    expect(tenantPost).toEqual({ allowed: true })
    expect(tenantApiPost).toEqual({ allowed: true })
  })
})

describe('tenant audit log access (HS-12)', () => {
  const pathname = '/api/tenants/acme/api/admin/audit/export'

  it('allows tenant owners and admins', () => {
    for (const tenantRole of ['owner', 'admin'] as const) {
      expect(
        authorizeApiRequest({ pathname, method: 'GET', principal: { actorId: 'u', tenantRole } })
      ).toEqual({ allowed: true })
    }
  })

  it('denies editors and members', () => {
    for (const tenantRole of ['editor', 'member'] as const) {
      expect(
        authorizeApiRequest({ pathname, method: 'GET', principal: { actorId: 'u', tenantRole } })
      ).toMatchObject({ allowed: false, status: 403 })
    }
  })
})
