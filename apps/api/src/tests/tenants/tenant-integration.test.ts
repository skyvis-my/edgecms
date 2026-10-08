import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import type { TenantContext } from '../../tenants/tenant-context'

// Mock the tenants repository for verifyTenantMembership
vi.mock('../../tenants/tenants.repository', () => ({
  tenantsRepository: {
    findTenantUser: vi.fn(),
  },
}))

// Use cache-busted dynamic import to avoid mock pollution from other test files
const { hasTenantContext, resolveTenantBindings, verifyTenantMembership } = await import(
  `../../tenants/tenant-context?bypass=${Date.now()}`
)

import { tenantsRepository } from '../../tenants/tenants.repository'

const mockRepo = tenantsRepository as unknown as {
  findTenantUser: ReturnType<typeof vi.fn>
}

describe('resolveTenantBindings', () => {
  const mockD1 = {} as D1Database
  const mockKV = {} as KVNamespace
  const mockR2 = {} as R2Bucket
  const mockEnv = { DB: mockD1, CACHE: mockKV, MEDIA: mockR2 }

  it('falls back to static env bindings when no tenant context', () => {
    const bindings = resolveTenantBindings(undefined, mockEnv)

    // Should return a db instance (wrapping the static D1)
    expect(bindings.db).toBeDefined()
    // KV and R2 should be the static env bindings
    expect(bindings.kv).toBe(mockKV)
    expect(bindings.r2).toBe(mockR2)
  })

  it('resolves bindings with tenant context present (shared infrastructure)', () => {
    const tenantContext: TenantContext = {
      tenant: {
        id: 'tenant-1',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active',
        mediaUploadMaxBytes: 5 * 1024 * 1024,
        mediaUploadMaxDimension: 2048,
        mediaAllowedMimeTypes: ['image/*'],
      },
      resources: {
        mode: 'shared',
      },
    }

    const bindings = resolveTenantBindings(tenantContext, mockEnv)

    // Currently falls back to static env (provisioning not wired up yet)
    expect(bindings.db).toBeDefined()
    expect(bindings.kv).toBe(mockKV)
    expect(bindings.r2).toBe(mockR2)
  })

  it('resolves bindings with tenant context that uses shared mode', () => {
    const tenantContext: TenantContext = {
      tenant: {
        id: 'tenant-2',
        slug: 'beta-co',
        name: 'Beta Co',
        status: 'active',
        mediaUploadMaxBytes: 5 * 1024 * 1024,
        mediaUploadMaxDimension: 2048,
        mediaAllowedMimeTypes: ['image/*'],
      },
      resources: { mode: 'shared' },
    }

    const bindings = resolveTenantBindings(tenantContext, mockEnv)

    // Should still return valid bindings (fallback to static)
    expect(bindings.db).toBeDefined()
    expect(bindings.kv).toBe(mockKV)
    expect(bindings.r2).toBe(mockR2)
  })

  it('returns all three binding types (db, kv, r2)', () => {
    const bindings = resolveTenantBindings(undefined, mockEnv)

    expect(bindings).toHaveProperty('db')
    expect(bindings).toHaveProperty('kv')
    expect(bindings).toHaveProperty('r2')
  })
})

describe('hasTenantContext', () => {
  it('returns true when tenant context is present', () => {
    const ctx = {
      tenant: {
        tenant: {
          id: 'tenant-1',
          slug: 'acme-corp',
          name: 'Acme Corp',
          status: 'active',
        },
        resources: { mode: 'shared' },
      },
    }

    expect(hasTenantContext(ctx)).toBe(true)
  })

  it('returns false when no tenant property', () => {
    const ctx = {}
    expect(hasTenantContext(ctx)).toBe(false)
  })

  it('returns false when tenant is null', () => {
    const ctx = { tenant: null }
    expect(hasTenantContext(ctx)).toBe(false)
  })

  it('returns false when tenant is undefined', () => {
    const ctx = { tenant: undefined }
    expect(hasTenantContext(ctx)).toBe(false)
  })

  it('returns false when tenant has wrong shape (no resources object)', () => {
    const ctx = {
      tenant: {
        tenant: { id: 'test' },
        // Missing resources
      },
    }
    expect(hasTenantContext(ctx)).toBe(false)
  })

  it('returns false when tenant has wrong shape (no inner tenant)', () => {
    const ctx = {
      tenant: {
        resources: { mode: 'shared' },
        // Missing inner tenant
      },
    }
    expect(hasTenantContext(ctx)).toBe(false)
  })

  it('returns false for non-object context', () => {
    expect(hasTenantContext(null)).toBe(false)
    expect(hasTenantContext(undefined)).toBe(false)
    expect(hasTenantContext('string')).toBe(false)
    expect(hasTenantContext(42)).toBe(false)
  })
})

describe('verifyTenantMembership', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the role when user is a member of the tenant', async () => {
    mockRepo.findTenantUser.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'admin',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const role = await verifyTenantMembership(db, 'user-1', 'tenant-1')

    expect(role).toBe('admin')
    expect(mockRepo.findTenantUser).toHaveBeenCalledWith(db, 'tenant-1', 'user-1')
  })

  it('returns null when user is not a member', async () => {
    mockRepo.findTenantUser.mockResolvedValue(undefined)

    const role = await verifyTenantMembership(db, 'user-1', 'tenant-1')

    expect(role).toBeNull()
    expect(mockRepo.findTenantUser).toHaveBeenCalledWith(db, 'tenant-1', 'user-1')
  })

  it('returns different roles correctly (owner)', async () => {
    mockRepo.findTenantUser.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const role = await verifyTenantMembership(db, 'user-1', 'tenant-1')
    expect(role).toBe('owner')
  })

  it('returns different roles correctly (member)', async () => {
    mockRepo.findTenantUser.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'member',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const role = await verifyTenantMembership(db, 'user-1', 'tenant-1')
    expect(role).toBe('member')
  })

  it('passes correct parameters to repository', async () => {
    mockRepo.findTenantUser.mockResolvedValue(undefined)

    await verifyTenantMembership(db, 'specific-user', 'specific-tenant')

    expect(mockRepo.findTenantUser).toHaveBeenCalledWith(db, 'specific-tenant', 'specific-user')
  })
})

describe('Controller binding resolution pattern', () => {
  /**
   * These tests verify the pattern used by controllers:
   * 1. Check if tenant context is available (hasTenantContext)
   * 2. If yes, extract tenant context
   * 3. Pass to resolveTenantBindings with env
   * 4. Get back db/kv/r2 bindings
   */

  const mockD1 = {} as D1Database
  const mockKV = {} as KVNamespace
  const mockR2 = {} as R2Bucket
  const mockEnv = { DB: mockD1, CACHE: mockKV, MEDIA: mockR2 }

  it('resolves correctly for non-tenant route (no tenant context)', () => {
    // Simulates a request to /api/admin/collections (no tenant middleware)
    const ctx = { params: {}, query: {} }

    const tenantCtx = hasTenantContext(ctx) ? (ctx as unknown as { tenant: TenantContext }).tenant : undefined
    const bindings = resolveTenantBindings(tenantCtx, mockEnv)

    expect(bindings.db).toBeDefined()
    expect(bindings.kv).toBe(mockKV)
    expect(bindings.r2).toBe(mockR2)
  })

  it('resolves correctly for tenant-scoped route (with tenant context)', () => {
    // Simulates a request to /api/tenants/acme-corp/admin/collections
    const ctx = {
      params: { tenantSlug: 'acme-corp' },
      query: {},
      tenant: {
        tenant: {
          id: 'tenant-1',
          slug: 'acme-corp',
          name: 'Acme Corp',
          status: 'active',
        },
        resources: {
          mode: 'shared',
        },
      },
    }

    const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
    const bindings = resolveTenantBindings(tenantCtx, mockEnv)

    // Should return resolved bindings (currently falls back to static env)
    expect(bindings.db).toBeDefined()
    expect(bindings.kv).toBe(mockKV)
    expect(bindings.r2).toBe(mockR2)
  })

  it('handles tenant context where middleware sets tenant to undefined', () => {
    // Edge case: middleware runs but sets tenant = undefined (no tenantSlug param)
    const ctx: {
      params: Record<string, string>
      query: Record<string, string>
      tenant?: TenantContext
    } = {
      params: {},
      query: {},
      tenant: undefined,
    }

    // hasTenantContext should return false for this
    expect(hasTenantContext(ctx)).toBe(false)

    const tenantCtx = hasTenantContext(ctx) ? ctx.tenant : undefined
    const bindings = resolveTenantBindings(tenantCtx, mockEnv)

    expect(bindings.db).toBeDefined()
    expect(bindings.kv).toBe(mockKV)
  })
})

describe('Membership verification integration', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('authorized user can proceed with tenant-scoped operations', async () => {
    // User is a member with admin role
    mockRepo.findTenantUser.mockResolvedValue({
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'admin',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const role = await verifyTenantMembership(db, 'user-1', 'tenant-1')
    expect(role).not.toBeNull()
    expect(role).toBe('admin')
  })

  it('unauthorized user is rejected from tenant-scoped operations', async () => {
    // User is NOT a member
    mockRepo.findTenantUser.mockResolvedValue(undefined)

    const role = await verifyTenantMembership(db, 'unauthorized-user', 'tenant-1')
    expect(role).toBeNull()
  })

  it('membership check with correct tenant and user IDs', async () => {
    mockRepo.findTenantUser.mockResolvedValue(undefined)

    // Simulate a controller checking membership
    const tenantContext: TenantContext = {
      tenant: {
        id: 'tenant-abc',
        slug: 'my-tenant',
        name: 'My Tenant',
        status: 'active',
        mediaUploadMaxBytes: 5 * 1024 * 1024,
        mediaUploadMaxDimension: 2048,
        mediaAllowedMimeTypes: ['image/*'],
      },
      resources: { mode: 'shared' },
    }

    const userId = 'user-xyz'
    const role = await verifyTenantMembership(db, userId, tenantContext.tenant.id)

    expect(mockRepo.findTenantUser).toHaveBeenCalledWith(db, 'tenant-abc', 'user-xyz')
    expect(role).toBeNull()
  })
})
