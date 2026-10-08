import { describe, expect, it, vi, beforeEach } from 'bun:test'
import type { Database } from '@/database/db'

const mockRbacRepository = {
  findRolesByTenant: vi.fn(),
  findRoleById: vi.fn(),
  findRoleByTenantAndId: vi.fn(),
  findRoleByTenantAndName: vi.fn(),
  findPermissionsByRole: vi.fn(),
  createRole: vi.fn(),
  createPermission: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  deletePermission: vi.fn(),
}

vi.mock('../../auth/rbac.repository', () => ({
  rbacRepository: mockRbacRepository,
}))

const { rbacService } = await import(`../../auth/rbac.service?bypass=${Date.now()}`)

describe('rbacService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('seedBuiltInRoles', () => {
    it('seeds four built-in roles with permissions when none exist', async () => {
      mockRbacRepository.findRoleByTenantAndName.mockResolvedValue(undefined)
      mockRbacRepository.createRole.mockImplementation(async (db, role) => ({
        ...role,
        id: `role-${role.name}`,
      }))
      mockRbacRepository.createPermission.mockResolvedValue({})

      await rbacService.seedBuiltInRoles({} as Database, 't1')

      expect(mockRbacRepository.createRole).toHaveBeenCalledTimes(4)
      expect(mockRbacRepository.createRole).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: expect.any(String),
          tenantId: 't1',
          name: 'viewer',
          description: 'Can read content only',
          isDefault: true,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        })
      )
      expect(mockRbacRepository.createRole).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: expect.any(String),
          tenantId: 't1',
          name: 'admin',
          description: 'Can manage all content and users',
          isDefault: false,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        })
      )
    })

    it('skips roles that already exist', async () => {
      mockRbacRepository.findRoleByTenantAndName.mockImplementation(
        async (db, tenantId, name) => {
          if (name === 'viewer') {
            return { id: 'existing-viewer', name: 'viewer', tenantId }
          }
          return undefined
        }
      )
      mockRbacRepository.createRole.mockImplementation(async (db, role) => ({
        ...role,
        id: `role-${role.name}`,
      }))

      await rbacService.seedBuiltInRoles({} as Database, 't1')

      expect(mockRbacRepository.createRole).toHaveBeenCalledTimes(3)
      expect(mockRbacRepository.createRole).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'viewer' })
      )
    })
  })

  describe('getRolesForTenant', () => {
    it('returns roles with permission counts', async () => {
      const roles = [
        {
          id: 'r1',
          tenantId: 't1',
          name: 'admin',
          description: 'Admin role',
          isDefault: false,
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
      ]
      const permissions = [
        { id: 'p1', roleId: 'r1', subject: 'collection:*', action: 'manage' },
        { id: 'p2', roleId: 'r1', subject: 'entry:*', action: 'manage' },
      ]

      mockRbacRepository.findRolesByTenant.mockResolvedValue(roles)
      mockRbacRepository.findPermissionsByRole.mockResolvedValue(permissions)

      const result = await rbacService.getRolesForTenant({} as Database, 't1')

      expect(result).toEqual({
        success: true,
        data: [
          {
            ...roles[0],
            permissionCount: 2,
          },
        ],
      })
    })

    it('returns empty array when no roles exist', async () => {
      mockRbacRepository.findRolesByTenant.mockResolvedValue([])

      const result = await rbacService.getRolesForTenant({} as Database, 't1')

      expect(result).toEqual({ success: true, data: [] })
    })
  })

  describe('getEffectivePermissions', () => {
    it('returns permissions for a role', async () => {
      const role = {
        id: 'r1',
        tenantId: 't1',
        name: 'custom-role',
        description: 'Custom',
        isDefault: false,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }
      const permissions = [
        { id: 'p1', roleId: 'r1', subject: 'collection:blog', action: 'update' },
        { id: 'p2', roleId: 'r1', subject: 'entry:*', action: 'read' },
      ]

      mockRbacRepository.findRoleByTenantAndName.mockResolvedValue(role)
      mockRbacRepository.findPermissionsByRole.mockResolvedValue(permissions)

      const result = await rbacService.getEffectivePermissions({} as Database, 't1', 'custom-role')

      expect(result.success).toBe(true)
      expect(result.data).toHaveLength(2)
      expect(result.data[0]).toMatchObject({ subject: 'collection:blog', action: 'update' })
      expect(result.data[1]).toMatchObject({ subject: 'entry:*', action: 'read' })
    })

    it('returns error when role not found', async () => {
      mockRbacRepository.findRoleByTenantAndName.mockResolvedValue(undefined)

      const result = await rbacService.getEffectivePermissions({} as Database, 't1', 'missing')

      expect(result).toEqual({
        success: false,
        error: { code: 'NOT_FOUND', message: "Role 'missing' not found for tenant" },
      })
    })
  })

  describe('canPerformAction', () => {
    it('returns true when permission exists', async () => {
      const permissions = [
        { id: 'p1', roleId: 'r1', subject: 'collection:blog', action: 'update' },
      ]

      mockRbacRepository.findRoleByTenantAndName.mockResolvedValue({ id: 'r1' })
      mockRbacRepository.findPermissionsByRole.mockResolvedValue(permissions)

      const result = await rbacService.canPerformAction(
        {} as Database,
        't1',
        'custom-role',
        'collection:blog',
        'update'
      )

      expect(result).toEqual({ success: true, data: true })
    })

    it('returns false when permission does not exist', async () => {
      const permissions = [
        { id: 'p1', roleId: 'r1', subject: 'collection:blog', action: 'read' },
      ]

      mockRbacRepository.findRoleByTenantAndName.mockResolvedValue({ id: 'r1' })
      mockRbacRepository.findPermissionsByRole.mockResolvedValue(permissions)

      const result = await rbacService.canPerformAction(
        {} as Database,
        't1',
        'custom-role',
        'collection:blog',
        'delete'
      )

      expect(result).toEqual({ success: true, data: false })
    })

    it('matches wildcard subject collection:*', async () => {
      const permissions = [
        { id: 'p1', roleId: 'r1', subject: 'collection:*', action: 'read' },
      ]

      mockRbacRepository.findRoleByTenantAndName.mockResolvedValue({ id: 'r1' })
      mockRbacRepository.findPermissionsByRole.mockResolvedValue(permissions)

      const result = await rbacService.canPerformAction(
        {} as Database,
        't1',
        'custom-role',
        'collection:blog',
        'read'
      )

      expect(result).toEqual({ success: true, data: true })
    })

    it('matches manage action wildcard', async () => {
      const permissions = [
        { id: 'p1', roleId: 'r1', subject: 'collection:*', action: 'manage' },
      ]

      mockRbacRepository.findRoleByTenantAndName.mockResolvedValue({ id: 'r1' })
      mockRbacRepository.findPermissionsByRole.mockResolvedValue(permissions)

      const result = await rbacService.canPerformAction(
        {} as Database,
        't1',
        'custom-role',
        'collection:blog',
        'delete'
      )

      expect(result).toEqual({ success: true, data: true })
    })
  })

  describe('createCustomRole', () => {
    it('creates a custom role with permissions', async () => {
      mockRbacRepository.findRoleByTenantAndName.mockResolvedValue(undefined)
      mockRbacRepository.createRole.mockImplementation(async (db, role) => ({
        ...role,
        id: 'new-role-id',
      }))
      mockRbacRepository.createPermission.mockResolvedValue({})

      const input = {
        name: 'content-editor',
        description: 'Can edit blog content',
        permissions: [
          { subject: 'collection:blog', action: 'read' },
          { subject: 'collection:blog', action: 'update' },
        ],
      }

      const result = await rbacService.createCustomRole({} as Database, 't1', input)

      expect(result.success).toBe(true)
      expect(mockRbacRepository.createRole).toHaveBeenCalledWith(expect.anything(), {
        id: expect.any(String),
        tenantId: 't1',
        name: 'content-editor',
        description: 'Can edit blog content',
        isDefault: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })
      expect(mockRbacRepository.createPermission).toHaveBeenCalledTimes(2)
    })

    it('returns error when role name already exists', async () => {
      mockRbacRepository.findRoleByTenantAndName.mockResolvedValue({
        id: 'existing',
        name: 'content-editor',
        tenantId: 't1',
      })

      const result = await rbacService.createCustomRole({} as Database, 't1', {
        name: 'content-editor',
      })

      expect(result).toEqual({
        success: false,
        error: {
          code: 'CONFLICT',
          message: "Role 'content-editor' already exists for tenant",
        },
      })
    })
  })

  describe('deleteCustomRole', () => {
    it('deletes a custom role', async () => {
      mockRbacRepository.findRoleByTenantAndId.mockResolvedValue({
        id: 'r1',
        name: 'custom-role',
        tenantId: 't1',
      })
      mockRbacRepository.deleteRole.mockResolvedValue(true)

      const result = await rbacService.deleteCustomRole({} as Database, 't1', 'r1')

      expect(result).toEqual({ success: true, data: { id: 'r1' } })
      expect(mockRbacRepository.findRoleByTenantAndId).toHaveBeenCalledWith(
        expect.anything(),
        't1',
        'r1'
      )
      expect(mockRbacRepository.deleteRole).toHaveBeenCalledWith(expect.anything(), 't1', 'r1')
    })

    it('prevents deletion of built-in roles', async () => {
      mockRbacRepository.findRoleByTenantAndId.mockResolvedValue({
        id: 'r1',
        name: 'admin',
        tenantId: 't1',
      })

      const result = await rbacService.deleteCustomRole({} as Database, 't1', 'r1')

      expect(result).toEqual({
        success: false,
        error: { code: 'FORBIDDEN', message: "Cannot delete built-in role 'admin'" },
      })
    })

    it('returns error when role not found', async () => {
      mockRbacRepository.findRoleByTenantAndId.mockResolvedValue(undefined)

      const result = await rbacService.deleteCustomRole({} as Database, 't1', 'missing')

      expect(result).toEqual({
        success: false,
        error: { code: 'NOT_FOUND', message: "Role 'missing' not found" },
      })
    })
  })

  describe('updateRole', () => {
    it('updates a custom role', async () => {
      mockRbacRepository.findRoleByTenantAndId.mockResolvedValue({
        id: 'r1',
        name: 'custom-role',
        tenantId: 't1',
      })
      mockRbacRepository.updateRole.mockResolvedValue({
        id: 'r1',
        name: 'updated-role',
        tenantId: 't1',
      })

      const result = await rbacService.updateRole({} as Database, 't1', 'r1', {
        name: 'updated-role',
      })

      expect(result).toEqual({
        success: true,
        data: { id: 'r1', name: 'updated-role', tenantId: 't1' },
      })
      expect(mockRbacRepository.updateRole).toHaveBeenCalledWith(
        expect.anything(),
        't1',
        'r1',
        expect.objectContaining({ name: 'updated-role' })
      )
    })

    it('prevents renaming built-in roles', async () => {
      mockRbacRepository.findRoleByTenantAndId.mockResolvedValue({
        id: 'r1',
        name: 'admin',
        tenantId: 't1',
      })

      const result = await rbacService.updateRole({} as Database, 't1', 'r1', {
        name: 'super-admin',
      })

      expect(result).toEqual({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Cannot rename built-in roles' },
      })
    })
  })
})
