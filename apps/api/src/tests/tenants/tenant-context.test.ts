import { describe, expect, it, vi } from 'bun:test'

const createDb = vi.fn(() => ({ __db: true }))
const findTenantUser = vi.fn()

vi.mock('@/database/db', () => ({ createDb }))
vi.mock('../../tenants/tenants.repository', () => ({
  tenantsRepository: { findTenantUser },
}))

const { hasTenantContext, getTenantContext, resolveTenantBindings, verifyTenantMembership } =
  await import(`../../tenants/tenant-context?bypass=${Date.now()}`)

describe('tenant-context', () => {
  it('hasTenantContext validates structure', () => {
    expect(hasTenantContext(null)).toBe(false)
    expect(hasTenantContext({})).toBe(false)
    expect(hasTenantContext({ tenant: null })).toBe(false)
    expect(hasTenantContext({ tenant: { tenant: {}, resources: { mode: 'shared' } } })).toBe(true)
  })

  it('getTenantContext returns ctx.tenant or throws when missing', () => {
    const tenant = {
      tenant: { id: 't1', slug: 'acme', name: 'Acme', status: 'active' },
      resources: { mode: 'shared' as const },
    }
    expect(getTenantContext({ tenant })).toEqual(tenant)
    expect(() => getTenantContext({} as never)).toThrow('Tenant context not available')
  })

  it('resolveTenantBindings uses worker env and createDb', () => {
    const env = { DB: {} as D1Database, CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket }
    const result = resolveTenantBindings(undefined, env)

    expect(createDb).toHaveBeenCalledWith(env.DB)
    expect(result).toEqual({ db: { __db: true }, kv: env.CACHE, r2: env.MEDIA })
  })

  it('verifyTenantMembership maps found and missing memberships', async () => {
    findTenantUser.mockResolvedValueOnce({ role: 'admin' }).mockResolvedValueOnce(undefined)

    const db = {} as never
    await expect(verifyTenantMembership(db, 'u1', 't1')).resolves.toBe('admin')
    await expect(verifyTenantMembership(db, 'u2', 't1')).resolves.toBeNull()
  })
})
