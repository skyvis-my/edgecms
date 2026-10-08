import { beforeEach, describe, expect, it, vi } from 'bun:test'

const mockFindUserTenants = vi.fn()
const mockCreateTenant = vi.fn()
const mockAddUserToTenant = vi.fn()

vi.mock('@/tenants/tenants.service', () => ({
  tenantsService: {
    findUserTenants: (...args: unknown[]) => mockFindUserTenants(...args),
    create: (...args: unknown[]) => mockCreateTenant(...args),
    addUserToTenant: (...args: unknown[]) => mockAddUserToTenant(...args),
  },
}))

describe('ensureUserHasOnboardingTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns existing tenant when user already has membership', async () => {
    mockFindUserTenants.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'tenant-1',
          slug: 'acme',
          name: 'Acme',
          status: 'active',
          localeCatalog: ['en'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const { ensureUserHasOnboardingTenant } = await import(
      `../../bootstrap/onboarding-tenant?case=${Date.now()}`
    )

    const result = await ensureUserHasOnboardingTenant({} as never, {
      id: 'user-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.slug).toBe('acme')
    expect(mockCreateTenant).not.toHaveBeenCalled()
    expect(mockAddUserToTenant).not.toHaveBeenCalled()
  })

  it('creates a dedicated tenant and owner membership for onboarding user', async () => {
    mockFindUserTenants.mockResolvedValue({ success: true, data: [] })
    mockCreateTenant.mockResolvedValue({
      success: true,
      data: {
        id: 'tenant-2',
        slug: 'jane-doe',
        name: 'Jane Doe Workspace',
        status: 'active',
        localeCatalog: ['en'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })
    mockAddUserToTenant.mockResolvedValue({
      success: true,
      data: { tenantId: 'tenant-2', userId: 'user-1', role: 'owner' },
    })

    const { ensureUserHasOnboardingTenant } = await import(
      `../../bootstrap/onboarding-tenant?case=${Date.now()}`
    )

    const result = await ensureUserHasOnboardingTenant({} as never, {
      id: 'user-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.slug).toBe('jane-doe')
    expect(mockCreateTenant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ slug: 'jane-doe' })
    )
    expect(mockAddUserToTenant).toHaveBeenCalledWith(expect.anything(), 'tenant-2', {
      userId: 'user-1',
      role: 'owner',
    })
  })

  it('retries with suffixed slug when the base slug is already taken', async () => {
    mockFindUserTenants.mockResolvedValue({ success: true, data: [] })
    mockCreateTenant
      .mockResolvedValueOnce({
        success: false,
        error: { code: 'CONFLICT', message: 'taken' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'tenant-3',
          slug: 'jane-doe-2',
          name: 'Jane Doe Workspace',
          status: 'active',
          localeCatalog: ['en'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      })
    mockAddUserToTenant.mockResolvedValue({
      success: true,
      data: { tenantId: 'tenant-3', userId: 'user-1', role: 'owner' },
    })

    const { ensureUserHasOnboardingTenant } = await import(
      `../../bootstrap/onboarding-tenant?case=${Date.now()}`
    )

    const result = await ensureUserHasOnboardingTenant({} as never, {
      id: 'user-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(mockCreateTenant).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ slug: 'jane-doe' })
    )
    expect(mockCreateTenant).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ slug: 'jane-doe-2' })
    )
  })
})
