import { beforeEach, describe, expect, it, vi } from 'bun:test'

const mockCreateAuth = vi.fn()
const mockFindFirstUserId = vi.fn()
const mockFindRoleById = vi.fn()
const mockFindMembershipRole = vi.fn()
const mockEnv = {
  DB: {
    prepare: vi.fn(),
  } as unknown as D1Database,
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters',
}

vi.mock('cloudflare:workers', () => ({
  env: mockEnv,
}))

vi.mock('../../auth/auth', () => ({
  createAuth: mockCreateAuth,
}))

vi.mock('@/database/db', () => ({
  createDb: vi.fn(() => ({})),
}))

vi.mock('@/users/users.repository', () => ({
  usersRepository: {
    findRoleById: mockFindRoleById,
    findFirstUserId: mockFindFirstUserId,
  },
}))

vi.mock('@/tenants/tenants.repository', () => ({
  tenantsRepository: {
    findMembershipRole: mockFindMembershipRole,
  },
}))

describe('resolveActorFromSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirstUserId.mockResolvedValue(undefined)
    mockFindRoleById.mockResolvedValue(undefined)
    mockFindMembershipRole.mockResolvedValue(undefined)
  })

  it('returns empty actor when no valid session exists', async () => {
    mockCreateAuth.mockReturnValue({
      api: { getSession: vi.fn(async () => null) },
    })
    const { resolveActorFromSession } = await import(`../../auth/rbac?case=${Date.now()}`)

    const actor = await resolveActorFromSession(
      new Request('http://localhost/api/admin/collections')
    )

    expect(actor).toEqual({})
  })

  it('uses role from session when available', async () => {
    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'u-1', email: 'first@example.com', role: 'editor' },
        })),
      },
    })
    const { resolveActorFromSession } = await import(`../../auth/rbac?case=${Date.now()}`)

    const actor = await resolveActorFromSession(
      new Request('http://localhost/api/admin/collections')
    )

    expect(actor).toEqual({ actorId: 'u-1', actorRole: 'editor' })
  })

  it('promotes first registered user to admin when session role is missing', async () => {
    mockFindFirstUserId.mockResolvedValue('u-first')
    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'u-first', email: 'first@example.com' },
        })),
      },
    })
    const { resolveActorFromSession } = await import(`../../auth/rbac?case=${Date.now()}`)

    const actor = await resolveActorFromSession(
      new Request('http://localhost/api/admin/collections')
    )

    expect(actor).toEqual({ actorId: 'u-first', actorRole: 'admin' })
  })

  it('uses persisted global user role when session role is missing', async () => {
    mockFindRoleById.mockResolvedValue('editor')
    mockCreateAuth.mockReturnValue({
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'u-2', email: 'editor@example.com' },
        })),
      },
    })
    const { resolveActorFromSession } = await import(`../../auth/rbac?case=${Date.now()}`)

    const actor = await resolveActorFromSession(
      new Request('http://localhost/api/admin/collections')
    )

    expect(actor).toEqual({ actorId: 'u-2', actorRole: 'editor' })
  })

  it('resolves tenant role by actor and tenant slug', async () => {
    mockFindMembershipRole.mockResolvedValue('admin')
    const { resolveTenantRoleForActor } = await import(`../../auth/rbac?case=${Date.now()}`)

    const role = await resolveTenantRoleForActor(mockEnv.DB, 'u-1', 'acme')

    expect(role).toBe('admin')
  })

  it('allows mutation for tenant admin roles', async () => {
    const { canMutateTenantRole } = await import(`../../auth/rbac?case=${Date.now()}`)

    expect(canMutateTenantRole('owner')).toBe(true)
    expect(canMutateTenantRole('admin')).toBe(true)
    expect(canMutateTenantRole('editor')).toBe(true)
    expect(canMutateTenantRole('member')).toBe(false)
    expect(canMutateTenantRole('viewer')).toBe(false)
    expect(canMutateTenantRole(undefined)).toBe(false)
  })

  it('requires editor-level role for tenant mutation proof', async () => {
    const { canMutateTenantRole } = await import(`../../auth/rbac?case=${Date.now()}`)
    type TenantRole = Parameters<typeof canMutateTenantRole>[0]

    expect(
      (['owner', 'admin', 'editor'] as TenantRole[]).every((role) => canMutateTenantRole(role))
    ).toBe(true)
    expect((['member', 'viewer'] as TenantRole[]).some((role) => canMutateTenantRole(role))).toBe(
      false
    )
  })

  it('classifies only write methods on admin routes as mutations', async () => {
    const { isAdminMutationPath } = await import(`../../auth/rbac?case=${Date.now()}`)

    expect(isAdminMutationPath('/api/admin/assets', 'POST')).toBe(true)
    expect(isAdminMutationPath('/api/tenants/acme/admin/assets/a1', 'DELETE')).toBe(true)
    expect(isAdminMutationPath('/api/admin/assets', 'GET')).toBe(false)
    expect(isAdminMutationPath('/api/public/articles', 'POST')).toBe(false)
  })
})
