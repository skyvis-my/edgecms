import { beforeEach, describe, expect, it, vi } from 'bun:test'

vi.mock('../../tenants/tenants.repository', () => ({
  tenantsRepository: {
    findById: vi.fn(),
    findBySlug: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
    addUserToTenant: vi.fn(),
    addUserToTenantQuery: vi.fn((_db: unknown, row: unknown) => ({ ownerRow: row })),
    getResources: vi.fn(),
  },
}))

vi.mock('../../auth/rbac.service', () => ({
  rbacService: { seedBuiltInRoles: vi.fn() },
}))

import type { Database } from '@/database/db'
import { tenantsRepository } from '../../tenants/tenants.repository'
import { rbacService } from '../../auth/rbac.service'
import { resolveHostPolicies, type TenantCreationActor } from '../../host/host-policies'
import type { TenantEventPublisher } from '../../host/tenant-events'

const { tenantsService } = await import(`../../tenants/tenants.service?bypass=${Date.now()}`)

type MockFn = ReturnType<typeof vi.fn>
const repo = tenantsRepository as unknown as Record<
  | 'findById'
  | 'findBySlug'
  | 'create'
  | 'update'
  | 'deleteById'
  | 'addUserToTenant'
  | 'addUserToTenantQuery'
  | 'getResources',
  MockFn
>
const rbac = rbacService as unknown as { seedBuiltInRoles: ReturnType<typeof vi.fn> }

const db = {} as Database
const tenant = {
  id: 't1',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  localeCatalog: ['en'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function actor(overrides: Partial<TenantCreationActor> = {}): TenantCreationActor {
  return {
    userId: 'u2',
    email: 'user@example.com',
    isSuperAdmin: false,
    source: 'admin-api',
    ...overrides,
  }
}

function recordingPublisher() {
  const published: { event: string; tenant: unknown; details: unknown }[] = []
  const events: TenantEventPublisher = {
    async publish(event, t, details) {
      published.push({ event, tenant: t, details })
    },
  }
  return { events, published }
}

describe('Tenant lifecycle (HS-02, HS-04, HS-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.findBySlug.mockResolvedValue(undefined)
    repo.create.mockImplementation(async (_db: unknown, values: Record<string, unknown>) => ({
      ...tenant,
      ...values,
    }))
    rbac.seedBuiltInRoles.mockResolvedValue(undefined)
    repo.addUserToTenant.mockResolvedValue({})
    repo.getResources.mockResolvedValue(undefined)
    repo.addUserToTenantQuery.mockImplementation((_db: unknown, row: unknown) => ({ ownerRow: row }))
  })

  describe('createForActor', () => {
    it('denies a non-super-admin under the default policy without writing', async () => {
      const result = await tenantsService.createForActor(
        db,
        { name: 'Acme', slug: 'acme' },
        actor(),
        resolveHostPolicies()
      )

      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.code).toBe('FORBIDDEN')
      expect(repo.create).not.toHaveBeenCalled()
    })

    it('makes a non-super-admin creator the tenant owner', async () => {
      const { events, published } = recordingPublisher()

      const result = await tenantsService.createForActor(
        db,
        { name: 'Acme', slug: 'acme' },
        actor(),
        resolveHostPolicies({ canCreateTenant: () => true }),
        { events }
      )

      expect(result.success).toBe(true)
      expect(repo.addUserToTenant).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ userId: 'u2', role: 'owner' })
      )
      expect(published).toEqual([
        { event: 'tenant.created', tenant: expect.objectContaining({ slug: 'acme' }), details: { actorId: 'u2' } },
      ])
    })

    it('does not add a super-admin creator as a member on the admin API', async () => {
      await tenantsService.createForActor(
        db,
        { name: 'Acme', slug: 'acme' },
        actor({ userId: 'u1', isSuperAdmin: true }),
        resolveHostPolicies()
      )

      expect(repo.create).toHaveBeenCalled()
      expect(repo.addUserToTenant).not.toHaveBeenCalled()
    })

    it('adds the owner in the same atomic batch when the driver supports it', async () => {
      const batched: unknown[][] = []
      const batchDb = {
        insert: vi.fn(() => ({ values: vi.fn((rows: unknown) => ({ rows })) })),
        batch: vi.fn(async (queries: unknown[]) => {
          batched.push(queries)
          return []
        }),
      }
      repo.findBySlug.mockResolvedValueOnce(undefined).mockResolvedValueOnce(tenant)

      const result = await tenantsService.createForActor(
        batchDb as unknown as Database,
        { name: 'Acme', slug: 'acme' },
        actor(),
        resolveHostPolicies({ canCreateTenant: () => true })
      )

      expect(result.success).toBe(true)
      // Tenant + roles + permissions + owner membership.
      expect(batched[0]).toHaveLength(4)
      expect(batched[0]).toContainEqual({
        ownerRow: expect.objectContaining({ userId: 'u2', role: 'owner' }),
      })
      expect(repo.addUserToTenant).not.toHaveBeenCalled()
    })

    it('creates the tenant in the host-chosen pending state', async () => {
      await tenantsService.createForActor(
        db,
        { name: 'Acme', slug: 'acme' },
        actor(),
        resolveHostPolicies({ canCreateTenant: () => ({ allowed: true, initialStatus: 'pending' }) })
      )

      expect(repo.create).toHaveBeenCalledWith(db, expect.objectContaining({ status: 'pending' }))
    })

    it('removes the tenant when adding the owner fails', async () => {
      repo.addUserToTenant.mockRejectedValueOnce(new Error('FOREIGN KEY constraint failed'))
      repo.deleteById.mockResolvedValue(true)
      const { events, published } = recordingPublisher()

      await expect(
        tenantsService.createForActor(
          db,
          { name: 'Acme', slug: 'acme' },
          actor(),
          resolveHostPolicies({ canCreateTenant: () => true }),
          { events }
        )
      ).rejects.toThrow('FOREIGN KEY')
      expect(repo.deleteById).toHaveBeenCalled()
      expect(published).toEqual([])
    })

    it('emits no event when creation fails', async () => {
      repo.findBySlug.mockResolvedValue(tenant)
      const { events, published } = recordingPublisher()

      const result = await tenantsService.createForActor(
        db,
        { name: 'Acme', slug: 'acme' },
        actor({ isSuperAdmin: true }),
        resolveHostPolicies(),
        { events }
      )

      expect(result.success).toBe(false)
      expect(published).toEqual([])
    })
  })

  describe('update status transitions', () => {
    const cases: [string, string, string | null][] = [
      ['active', 'suspended', 'tenant.suspended'],
      ['suspended', 'active', 'tenant.activated'],
      ['pending', 'active', 'tenant.activated'],
      ['disabled', 'active', 'tenant.activated'],
      ['active', 'disabled', null],
      ['active', 'active', null],
    ]

    for (const [from, to, expected] of cases) {
      it(`${from} -> ${to} emits ${expected ?? 'nothing'}`, async () => {
        repo.findById.mockResolvedValue({ ...tenant, status: from })
        repo.update.mockResolvedValue({ ...tenant, status: to })
        const { events, published } = recordingPublisher()

        const result = await tenantsService.update(db, 't1', { status: to }, { events, actorId: 'u1' })

        expect(result.success).toBe(true)
        if (expected) {
          expect(published).toEqual([
            {
              event: expected,
              tenant: expect.objectContaining({ id: 't1', status: to }),
              details: { previousStatus: from, actorId: 'u1' },
            },
          ])
        } else {
          expect(published).toEqual([])
        }
      })
    }

    it('rejects unknown statuses', async () => {
      repo.findById.mockResolvedValue(tenant)

      const result = await tenantsService.update(db, 't1', { status: 'archived' })

      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(repo.update).not.toHaveBeenCalled()
    })
  })

  describe('deleteById', () => {
    it('emits tenant.deleted with the deleted tenant', async () => {
      repo.findById.mockResolvedValue(tenant)
      repo.deleteById.mockResolvedValue(true)
      const { events, published } = recordingPublisher()

      await tenantsService.deleteById(db, 't1', undefined, { events, actorId: 'u1' })

      expect(published).toEqual([
        { event: 'tenant.deleted', tenant: expect.objectContaining({ id: 't1' }), details: { actorId: 'u1' } },
      ])
    })

    it('emits nothing when the tenant does not exist', async () => {
      repo.findById.mockResolvedValue(undefined)
      repo.deleteById.mockResolvedValue(false)
      const { events, published } = recordingPublisher()

      const result = await tenantsService.deleteById(db, 'missing', undefined, { events })

      expect(result.success).toBe(false)
      expect(published).toEqual([])
    })
  })
})
