import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'

// Mock the repository module
vi.mock('../../tenants/tenants.repository', () => ({
  tenantsRepository: {
    findAll: vi.fn(),
    findAllWithUserCount: vi.fn(),
    findById: vi.fn(),
    findBySlug: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
    findUserTenants: vi.fn(),
    findTenantUsers: vi.fn(),
    findTenantUsersWithDetails: vi.fn(),
    findTenantUser: vi.fn(),
    addUserToTenant: vi.fn(),
    removeUserFromTenant: vi.fn(),
    updateUserRole: vi.fn(),
    getResources: vi.fn(),
    setResources: vi.fn(),
    deleteResources: vi.fn(),
  },
}))

// Mock rbacService for role seeding
vi.mock('../../auth/rbac.service', () => ({
  rbacService: {
    seedBuiltInRoles: vi.fn(),
  },
}))

import type { Database } from '@/database/db'
// Import after mocking
import { tenantsRepository } from '../../tenants/tenants.repository'
import { rbacService } from '../../auth/rbac.service'

const { tenantsService } = await import(`../../tenants/tenants.service?bypass=${Date.now()}`)

const mockRepo = tenantsRepository as unknown as {
  findAll: ReturnType<typeof vi.fn>
  findAllWithUserCount: ReturnType<typeof vi.fn>
  findById: ReturnType<typeof vi.fn>
  findBySlug: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  deleteById: ReturnType<typeof vi.fn>
  findUserTenants: ReturnType<typeof vi.fn>
  findTenantUsers: ReturnType<typeof vi.fn>
  findTenantUsersWithDetails: ReturnType<typeof vi.fn>
  findTenantUser: ReturnType<typeof vi.fn>
  addUserToTenant: ReturnType<typeof vi.fn>
  removeUserFromTenant: ReturnType<typeof vi.fn>
  updateUserRole: ReturnType<typeof vi.fn>
  getResources: ReturnType<typeof vi.fn>
  setResources: ReturnType<typeof vi.fn>
  deleteResources: ReturnType<typeof vi.fn>
}

const mockRbacService = rbacService as unknown as {
  seedBuiltInRoles: ReturnType<typeof vi.fn>
}

describe('TenantsService', () => {
  const db = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'mock-uuid' as `${string}-${string}-${string}-${string}-${string}`
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('create', () => {
    it('rejects invalid target URL', async () => {
      mockRepo.findBySlug.mockResolvedValue(undefined)

      const result = await tenantsService.create(db, {
        name: 'Acme Corp',
        slug: 'acme-corp',
        targetUrl: 'not-a-url',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('targetUrl')
      }
    })

    it('creates tenant with targetUrl and corsOrigin', async () => {
      mockRepo.findBySlug.mockResolvedValue(undefined)
      mockRepo.create.mockResolvedValue({
        id: 'mock-uuid',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active',
        localeCatalog: ['en', 'fr'],
        targetUrl: 'https://origin.example.com',
        corsOrigin: 'https://admin.example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })

      const result = await tenantsService.create(db, {
        name: 'Acme Corp',
        slug: 'acme-corp',
        localeCatalog: ['en', 'fr'],
        targetUrl: 'https://origin.example.com',
        corsOrigin: 'https://admin.example.com',
      })

      expect(result.success).toBe(true)
      expect(mockRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          targetUrl: 'https://origin.example.com',
          corsOrigin: 'https://admin.example.com',
        })
      )
    })

    it('creates tenant with explicit locale catalog', async () => {
      mockRepo.findBySlug.mockResolvedValue(undefined)
      mockRepo.create.mockResolvedValue({
        id: 'mock-uuid',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active',
        localeCatalog: ['en', 'fr'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })

      const result = await tenantsService.create(db, {
        name: 'Acme Corp',
        slug: 'acme-corp',
        localeCatalog: ['en', 'fr'],
      })

      expect(result.success).toBe(true)
      expect(mockRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ localeCatalog: ['en', 'fr'] })
      )
    })

    it('uses default locale catalog when none is provided', async () => {
      mockRepo.findBySlug.mockResolvedValue(undefined)
      mockRepo.create.mockResolvedValue({
        id: 'mock-uuid',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active',
        localeCatalog: ['en'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })

      await tenantsService.create(db, {
        name: 'Acme Corp',
        slug: 'acme-corp',
      })

      expect(mockRepo.create).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ localeCatalog: expect.arrayContaining(['en']) })
      )
    })

    it('rejects invalid locale catalog entries', async () => {
      mockRepo.findBySlug.mockResolvedValue(undefined)

      const result = await tenantsService.create(db, {
        name: 'Acme Corp',
        slug: 'acme-corp',
        localeCatalog: ['en', 'en'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('localeCatalog')
      }
    })

    it('creates a tenant with valid slug', async () => {
      mockRepo.findBySlug.mockResolvedValue(undefined)
      const created = {
        id: 'mock-uuid',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      mockRepo.create.mockResolvedValue(created)

      const result = await tenantsService.create(db, {
        name: 'Acme Corp',
        slug: 'acme-corp',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.slug).toBe('acme-corp')
        expect(result.data.name).toBe('Acme Corp')
        expect(result.data.status).toBe('active')
      }
    })

    it('rejects invalid slug format', async () => {
      const result = await tenantsService.create(db, {
        name: 'Test',
        slug: 'Invalid_Slug',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('lowercase alphanumeric')
      }
    })

    it('rejects slug with leading hyphen', async () => {
      const result = await tenantsService.create(db, {
        name: 'Test',
        slug: '-invalid',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('rejects slug with trailing hyphen', async () => {
      const result = await tenantsService.create(db, {
        name: 'Test',
        slug: 'invalid-',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('rejects duplicate slug', async () => {
      const existing = {
        id: 'existing-id',
        slug: 'acme-corp',
        name: 'Existing Corp',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      mockRepo.findBySlug.mockResolvedValue(existing)

      const result = await tenantsService.create(db, {
        name: 'Acme Corp',
        slug: 'acme-corp',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('CONFLICT')
        expect(result.error.message).toContain('already exists')
      }
    })

    it('seeds built-in RBAC roles after creating tenant', async () => {
      const created = {
        id: 'mock-uuid',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active',
        localeCatalog: ['en'],
        targetUrl: null,
        corsOrigin: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findBySlug.mockResolvedValue(undefined)
      mockRepo.create.mockResolvedValue(created)
      mockRbacService.seedBuiltInRoles.mockResolvedValue(undefined)

      const result = await tenantsService.create(db, {
        name: 'Acme Corp',
        slug: 'acme-corp',
      })

      expect(result.success).toBe(true)
      expect(mockRbacService.seedBuiltInRoles).toHaveBeenCalledWith(db, 'mock-uuid')
    })
  })

  describe('update', () => {
    it('rejects invalid cors origin on update', async () => {
      const existingTenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        localeCatalog: ['en'],
        targetUrl: null,
        corsOrigin: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      mockRepo.findById.mockResolvedValue(existingTenant)

      const result = await tenantsService.update(db, 'test-id', {
        corsOrigin: 'bad-origin',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('corsOrigin')
      }
    })

    it('updates tenant locale catalog', async () => {
      const existingTenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        localeCatalog: ['en'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const updated = { ...existingTenant, localeCatalog: ['en', 'fr'] }

      mockRepo.findById.mockResolvedValue(existingTenant)
      mockRepo.update.mockResolvedValue(updated)

      const result = await tenantsService.update(db, 'test-id', {
        localeCatalog: ['en', 'fr'],
      })

      expect(result.success).toBe(true)
      expect(mockRepo.update).toHaveBeenCalledWith(
        db,
        'test-id',
        expect.objectContaining({ localeCatalog: ['en', 'fr'] })
      )
    })

    it('rejects invalid locale catalog on update', async () => {
      const existingTenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        localeCatalog: ['en'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      mockRepo.findById.mockResolvedValue(existingTenant)

      const result = await tenantsService.update(db, 'test-id', {
        localeCatalog: [],
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('localeCatalog')
      }
    })

    it('updates tenant name', async () => {
      const existingTenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const updated = { ...existingTenant, name: 'New Name' }

      mockRepo.findById.mockResolvedValue(existingTenant)
      mockRepo.update.mockResolvedValue(updated)

      const result = await tenantsService.update(db, 'test-id', {
        name: 'New Name',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('New Name')
      }
    })

    it('rejects invalid status', async () => {
      const existingTenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(existingTenant)

      const result = await tenantsService.update(db, 'test-id', {
        status: 'invalid-status',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('returns error for non-existent tenant', async () => {
      mockRepo.findById.mockResolvedValue(undefined)

      const result = await tenantsService.update(db, 'non-existent', {
        name: 'New Name',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('rejects invalid slug on update', async () => {
      const existingTenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      mockRepo.findById.mockResolvedValue(existingTenant)

      const result = await tenantsService.update(db, 'test-id', { slug: 'Invalid_Slug' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('returns NOT_FOUND when repository update yields no row', async () => {
      const existingTenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      mockRepo.findById.mockResolvedValue(existingTenant)
      mockRepo.update.mockResolvedValue(undefined)

      const result = await tenantsService.update(db, 'test-id', { name: 'new' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  describe('addUserToTenant', () => {
    it('returns NOT_FOUND when tenant is missing', async () => {
      mockRepo.findById.mockResolvedValue(undefined)

      const result = await tenantsService.addUserToTenant(db, 'missing', {
        userId: 'user-id',
        role: 'member',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('adds a user with valid role', async () => {
      const tenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const membership = {
        tenantId: 'test-id',
        userId: 'user-id',
        role: 'member',
        createdAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(tenant)
      mockRepo.findTenantUser.mockResolvedValue(undefined)
      mockRepo.addUserToTenant.mockResolvedValue(membership)

      const result = await tenantsService.addUserToTenant(db, 'test-id', {
        userId: 'user-id',
        role: 'member',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.role).toBe('member')
      }
    })

    it('rejects invalid role', async () => {
      const tenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(tenant)

      const result = await tenantsService.addUserToTenant(db, 'test-id', {
        userId: 'user-id',
        role: 'invalid-role',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('owner, admin, member')
      }
    })

    it('rejects duplicate membership', async () => {
      const tenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      const existingMembership = {
        tenantId: 'test-id',
        userId: 'user-id',
        role: 'member',
        createdAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(tenant)
      mockRepo.findTenantUser.mockResolvedValue(existingMembership)

      const result = await tenantsService.addUserToTenant(db, 'test-id', {
        userId: 'user-id',
        role: 'member',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('CONFLICT')
        expect(result.error.message).toContain('already a member')
      }
    })
  })

  describe('removeUserFromTenant', () => {
    it('removes a user from tenant', async () => {
      mockRepo.removeUserFromTenant.mockResolvedValue(true)

      const result = await tenantsService.removeUserFromTenant(db, 'test-id', 'user-id')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.tenantId).toBe('test-id')
        expect(result.data.userId).toBe('user-id')
      }
    })

    it('returns error when user is not a member', async () => {
      mockRepo.removeUserFromTenant.mockResolvedValue(false)

      const result = await tenantsService.removeUserFromTenant(db, 'test-id', 'user-id')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  describe('findTenantUsers', () => {
    it('returns users for an existing tenant', async () => {
      const tenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const users = [
        {
          tenantId: 'test-id',
          userId: 'user-1',
          role: 'owner',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          tenantId: 'test-id',
          userId: 'user-2',
          role: 'member',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]

      mockRepo.findById.mockResolvedValue(tenant)
      mockRepo.findTenantUsers.mockResolvedValue(users)

      const result = await tenantsService.findTenantUsers(db, 'test-id')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(2)
        expect(result.data[0]?.role).toBe('owner')
      }
    })

    it('returns NOT_FOUND for non-existent tenant', async () => {
      mockRepo.findById.mockResolvedValue(undefined)

      const result = await tenantsService.findTenantUsers(db, 'non-existent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  describe('updateUserRole', () => {
    it('updates a user role successfully', async () => {
      const updated = {
        tenantId: 'test-id',
        userId: 'user-id',
        role: 'admin',
        createdAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.updateUserRole.mockResolvedValue(updated)

      const result = await tenantsService.updateUserRole(db, 'test-id', 'user-id', 'admin')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.role).toBe('admin')
      }
    })

    it('rejects invalid role', async () => {
      const result = await tenantsService.updateUserRole(db, 'test-id', 'user-id', 'superadmin')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('owner, admin, member')
      }
    })

    it('returns NOT_FOUND when user is not a member', async () => {
      mockRepo.updateUserRole.mockResolvedValue(undefined)

      const result = await tenantsService.updateUserRole(db, 'test-id', 'user-id', 'admin')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  describe('findAll', () => {
    it('returns all tenants with user counts', async () => {
      const tenants = [
        {
          id: 't1',
          slug: 'first',
          name: 'First',
          status: 'active',
          localeCatalog: ['en'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          userCount: 3,
        },
        {
          id: 't2',
          slug: 'second',
          name: 'Second',
          status: 'active',
          localeCatalog: ['en'],
          targetUrl: null,
          corsOrigin: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          userCount: 0,
        },
      ]

      mockRepo.findAllWithUserCount.mockResolvedValue(tenants)

      const result = await tenantsService.findAll(db)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(2)
        expect(result.data[0]?.userCount).toBe(3)
        expect(result.data[1]?.userCount).toBe(0)
      }
    })
  })

  describe('findByIdOrSlugWithUsers', () => {
    it('returns tenant with users when found by ID', async () => {
      const tenant = {
        id: 'uuid-123',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        localeCatalog: ['en'],
        targetUrl: null,
        corsOrigin: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const users = [
        { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'owner' },
        { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'member' },
      ]

      mockRepo.findById.mockResolvedValue(tenant)
      mockRepo.findTenantUsersWithDetails.mockResolvedValue(users)

      const result = await tenantsService.findByIdOrSlugWithUsers(db, 'uuid-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('uuid-123')
        expect(result.data.users).toHaveLength(2)
        expect(result.data.users[0]?.name).toBe('Alice')
        expect(result.data.users[0]?.email).toBe('alice@example.com')
        expect(result.data.users[1]?.role).toBe('member')
      }
    })

    it('returns NOT_FOUND when tenant does not exist', async () => {
      mockRepo.findById.mockResolvedValue(undefined)
      mockRepo.findBySlug.mockResolvedValue(undefined)

      const result = await tenantsService.findByIdOrSlugWithUsers(db, 'nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
      expect(mockRepo.findTenantUsersWithDetails).not.toHaveBeenCalled()
    })

    it('returns tenant with empty users array when no members', async () => {
      const tenant = {
        id: 'uuid-123',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        localeCatalog: ['en'],
        targetUrl: null,
        corsOrigin: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(tenant)
      mockRepo.findTenantUsersWithDetails.mockResolvedValue([])

      const result = await tenantsService.findByIdOrSlugWithUsers(db, 'uuid-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.users).toEqual([])
      }
    })
  })

  describe('findTenantUsersWithDetails', () => {
    it('returns users with profile details for existing tenant', async () => {
      const tenant = {
        id: 'test-id',
        slug: 'acme-corp',
        name: 'Acme Corp',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const users = [
        { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'owner' },
      ]

      mockRepo.findById.mockResolvedValue(tenant)
      mockRepo.findTenantUsersWithDetails.mockResolvedValue(users)

      const result = await tenantsService.findTenantUsersWithDetails(db, 'test-id')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toHaveLength(1)
        expect(result.data[0]?.name).toBe('Alice')
        expect(result.data[0]?.email).toBe('alice@example.com')
      }
    })

    it('returns NOT_FOUND for non-existent tenant', async () => {
      mockRepo.findById.mockResolvedValue(undefined)

      const result = await tenantsService.findTenantUsersWithDetails(db, 'non-existent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  describe('findUserTenants', () => {
    it('returns all tenants for a user', async () => {
      const tenants = [
        {
          id: 't1',
          slug: 'first',
          name: 'First',
          status: 'active',
          localeCatalog: ['en'],
          targetUrl: null,
          corsOrigin: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]
      mockRepo.findUserTenants.mockResolvedValue(tenants)

      const result = await tenantsService.findUserTenants(db, 'u1')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(tenants)
      }
    })
  })

  describe('findByIdOrSlug', () => {
    it('finds by ID first', async () => {
      const tenant = {
        id: 'uuid-123',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        localeCatalog: ['en'],
        targetUrl: null,
        corsOrigin: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(tenant)

      const result = await tenantsService.findByIdOrSlug(db, 'uuid-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('uuid-123')
      }
      expect(mockRepo.findBySlug).not.toHaveBeenCalled()
    })

    it('falls back to slug when ID not found', async () => {
      const tenant = {
        id: 'uuid-123',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        localeCatalog: ['en'],
        targetUrl: null,
        corsOrigin: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(undefined)
      mockRepo.findBySlug.mockResolvedValue(tenant)

      const result = await tenantsService.findByIdOrSlug(db, 'acme')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.slug).toBe('acme')
      }
    })

    it('returns NOT_FOUND when neither ID nor slug matches', async () => {
      mockRepo.findById.mockResolvedValue(undefined)
      mockRepo.findBySlug.mockResolvedValue(undefined)

      const result = await tenantsService.findByIdOrSlug(db, 'nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  describe('deleteById', () => {
    it('deletes an existing tenant', async () => {
      mockRepo.deleteById.mockResolvedValue(true)

      const result = await tenantsService.deleteById(db, 'test-id')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('test-id')
      }
    })

    it('returns NOT_FOUND for non-existent tenant', async () => {
      mockRepo.deleteById.mockResolvedValue(false)

      const result = await tenantsService.deleteById(db, 'non-existent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  describe('update slug conflict detection', () => {
    it('allows updating slug when no conflict', async () => {
      const existingTenant = {
        id: 'test-id',
        slug: 'old-slug',
        name: 'Test',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(existingTenant)
      mockRepo.findBySlug.mockResolvedValue(undefined) // No conflict
      mockRepo.update.mockResolvedValue({ ...existingTenant, slug: 'new-slug' })

      const result = await tenantsService.update(db, 'test-id', { slug: 'new-slug' })

      expect(result.success).toBe(true)
    })

    it('rejects slug that conflicts with another tenant', async () => {
      const existingTenant = {
        id: 'test-id',
        slug: 'old-slug',
        name: 'Test',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const conflictingTenant = {
        id: 'other-id',
        slug: 'taken-slug',
        name: 'Other',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(existingTenant)
      mockRepo.findBySlug.mockResolvedValue(conflictingTenant)

      const result = await tenantsService.update(db, 'test-id', { slug: 'taken-slug' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('CONFLICT')
      }
    })

    it('allows updating to same slug (self-conflict is OK)', async () => {
      const existingTenant = {
        id: 'test-id',
        slug: 'same-slug',
        name: 'Test',
        status: 'active' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(existingTenant)
      mockRepo.findBySlug.mockResolvedValue(existingTenant) // Self-conflict
      mockRepo.update.mockResolvedValue(existingTenant)

      const result = await tenantsService.update(db, 'test-id', { slug: 'same-slug' })

      expect(result.success).toBe(true)
    })
  })

  describe('provision', () => {
    it('returns NOT_FOUND when tenant does not exist', async () => {
      mockRepo.findById.mockResolvedValue(undefined)

      const result = await tenantsService.provision(db, 'non-existent', {
        accountId: 'acc-123',
        apiToken: 'token',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('returns CONFLICT when resources already provisioned', async () => {
      const tenant = {
        id: 'test-id',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(tenant)
      mockRepo.getResources.mockResolvedValue({
        tenantId: 'test-id',
        d1DatabaseId: 'already-provisioned',
        kvNamespaceId: null,
        r2BucketName: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })

      const result = await tenantsService.provision(db, 'test-id', {
        accountId: 'acc-123',
        apiToken: 'token',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('CONFLICT')
        expect(result.error.message).toContain('already has provisioned resources')
      }
    })
    it('returns PROVISIONING_ERROR when provisioning runtime throws', async () => {
      const tenant = {
        id: 'test-id',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(tenant)
      mockRepo.getResources.mockResolvedValue(undefined)
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

      const result = await tenantsService.provision(db, 'test-id', {
        accountId: 'acc-123',
        apiToken: 'token',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('PROVISIONING_ERROR')
      }
    })
  })

  describe('deprovision', () => {
    it('returns NOT_FOUND when tenant does not exist', async () => {
      mockRepo.findById.mockResolvedValue(undefined)

      const result = await tenantsService.deprovision(db, 'non-existent', {
        accountId: 'acc-123',
        apiToken: 'token',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
    it('returns DEPROVISIONING_ERROR when runtime deprovision throws', async () => {
      const tenant = {
        id: 'test-id',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }

      mockRepo.findById.mockResolvedValue(tenant)
      mockRepo.getResources.mockResolvedValue(undefined)

      const result = await tenantsService.deprovision(db, 'test-id', {
        accountId: 'acc-123',
        apiToken: 'token',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DEPROVISIONING_ERROR')
      }
    })
  })
})
