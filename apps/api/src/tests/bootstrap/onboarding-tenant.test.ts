import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { resolveHostPolicies, type TenantCreationActor } from '../../host/host-policies'

const mockFindUserTenants = vi.fn()
const mockCreateAuthorized = vi.fn()

vi.mock('@/tenants/tenants.service', () => ({
  tenantsService: {
    findUserTenants: (...args: unknown[]) => mockFindUserTenants(...args),
    // Mirrors the real authorizeCreation contract: ask the host policy once.
    authorizeCreation: async (
      actor: TenantCreationActor,
      host: ReturnType<typeof resolveHostPolicies>
    ) => {
      const decision = await host.canCreateTenant(actor)
      return decision.allowed
        ? { success: true, data: { initialStatus: decision.initialStatus } }
        : { success: false, error: { code: 'FORBIDDEN', message: decision.reason ?? 'denied' } }
    },
    createAuthorized: (...args: unknown[]) => mockCreateAuthorized(...args),
  },
}))

function tenantRow(id: string, slug: string) {
  return {
    id,
    slug,
    name: 'Jane Doe Workspace',
    status: 'active',
    localeCatalog: ['en'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const user = { id: 'user-1', name: 'Jane Doe', email: 'jane@example.com' }

async function load() {
  return import(`../../bootstrap/onboarding-tenant?case=${Date.now()}-${Math.random()}`)
}

describe('ensureUserHasOnboardingTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns existing tenant when user already has membership', async () => {
    mockFindUserTenants.mockResolvedValue({ success: true, data: [tenantRow('tenant-1', 'acme')] })

    const { ensureUserHasOnboardingTenant } = await load()
    const result = await ensureUserHasOnboardingTenant({} as never, user)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.slug).toBe('acme')
    expect(mockCreateAuthorized).not.toHaveBeenCalled()
  })

  it('creates a tenant owned by the onboarding user under the default policy', async () => {
    mockFindUserTenants.mockResolvedValue({ success: true, data: [] })
    mockCreateAuthorized.mockResolvedValue({ success: true, data: tenantRow('tenant-2', 'jane-doe') })

    const { ensureUserHasOnboardingTenant } = await load()
    const result = await ensureUserHasOnboardingTenant({} as never, user)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.slug).toBe('jane-doe')
    expect(mockCreateAuthorized).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ slug: 'jane-doe' }),
      expect.objectContaining({ userId: 'user-1', source: 'onboarding', isSuperAdmin: false }),
      'active',
      expect.anything()
    )
  })

  it('retries with suffixed slug and asks the host policy only once', async () => {
    mockFindUserTenants.mockResolvedValue({ success: true, data: [] })
    mockCreateAuthorized
      .mockResolvedValueOnce({ success: false, error: { code: 'CONFLICT', message: 'taken' } })
      .mockResolvedValueOnce({ success: true, data: tenantRow('tenant-3', 'jane-doe-2') })
    const canCreateTenant = vi.fn(() => true)

    const { ensureUserHasOnboardingTenant } = await load()
    const result = await ensureUserHasOnboardingTenant({} as never, user, {
      host: resolveHostPolicies({ canCreateTenant }),
    })

    expect(result.success).toBe(true)
    expect(canCreateTenant).toHaveBeenCalledTimes(1)
    expect(mockCreateAuthorized).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ slug: 'jane-doe' }),
      expect.anything(),
      'active',
      expect.anything()
    )
    expect(mockCreateAuthorized).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ slug: 'jane-doe-2' }),
      expect.anything(),
      'active',
      expect.anything()
    )
  })

  it('returns FORBIDDEN and creates nothing when the host policy denies onboarding', async () => {
    mockFindUserTenants.mockResolvedValue({ success: true, data: [] })

    const { ensureUserHasOnboardingTenant } = await load()
    const result = await ensureUserHasOnboardingTenant({} as never, user, {
      host: resolveHostPolicies({
        canCreateTenant: () => ({ allowed: false, reason: 'Invite required' }),
      }),
    })

    expect(result).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Invite required' },
    })
    expect(mockCreateAuthorized).not.toHaveBeenCalled()
  })

  it('passes a host-chosen pending status to tenant creation', async () => {
    mockFindUserTenants.mockResolvedValue({ success: true, data: [] })
    mockCreateAuthorized.mockResolvedValue({ success: true, data: tenantRow('tenant-4', 'jane-doe') })

    const { ensureUserHasOnboardingTenant } = await load()
    await ensureUserHasOnboardingTenant({} as never, user, {
      host: resolveHostPolicies({
        canCreateTenant: () => ({ allowed: true, initialStatus: 'pending' }),
      }),
    })

    expect(mockCreateAuthorized).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'pending',
      expect.anything()
    )
  })
})
