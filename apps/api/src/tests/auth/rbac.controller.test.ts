import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'

const mockRbacService = {
  getRolesForTenant: vi.fn(),
  getEffectivePermissions: vi.fn(),
  createCustomRole: vi.fn(),
  updateRole: vi.fn(),
  deleteCustomRole: vi.fn(),
}

vi.mock('cloudflare:workers', () => ({
  env: { DB: {} },
}))

vi.mock('@/database/db', () => ({
  createDb: () => ({}),
}))

vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia().macro({
    auth: {
      derive() {
        return { user: { id: 'u1' } }
      },
    },
  }),
}))

vi.mock('../../auth/rbac.service', () => ({
  rbacService: mockRbacService,
}))

// Cache-busted import: @/app (loaded by app/main tests) binds the real
// rbac.controller; a plain import would reuse that copy with real auth.
const { rbacController } = await import(`../../auth/rbac.controller?bypass=${Date.now()}`)

const mockTenantCtx = {
  tenant: {
    id: 'tenant-1',
    slug: 'tenant-1',
    name: 'Tenant 1',
    status: 'active',
    mediaUploadMaxBytes: 1000,
    mediaUploadMaxDimension: 1000,
    mediaAllowedMimeTypes: [],
  },
  resources: { mode: 'shared' as const },
}

describe('rbacController', () => {
  const appWithTenant = new Elysia()
    .state('tenant', mockTenantCtx)
    .use(rbacController)

  const appWithoutTenant = new Elysia().use(rbacController)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/admin/roles', () => {
    it('returns 400 when tenant context is missing', async () => {
      const res = await appWithoutTenant.handle(
        new Request('http://localhost/api/admin/roles')
      )
      expect(res.status).toBe(400)
    })

    it('returns list of roles on success', async () => {
      mockRbacService.getRolesForTenant.mockResolvedValueOnce({
        success: true,
        data: [{ id: 'role-1', name: 'editor' }],
      })

      const res = await appWithTenant.handle(
        new Request('http://localhost/api/admin/roles')
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { success: boolean; data: unknown[] }
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
    })

    it('returns 404 when service returns error', async () => {
      mockRbacService.getRolesForTenant.mockResolvedValueOnce({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tenant not found' },
      })

      const res = await appWithTenant.handle(
        new Request('http://localhost/api/admin/roles')
      )
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/admin/roles/:roleId', () => {
    it('returns 404 when role ID does not exist in tenant', async () => {
      mockRbacService.getRolesForTenant.mockResolvedValueOnce({
        success: true,
        data: [{ id: 'role-1', name: 'editor' }],
      })

      const res = await appWithTenant.handle(
        new Request('http://localhost/api/admin/roles/role-999')
      )
      expect(res.status).toBe(404)
    })

    it('returns role details with effective permissions', async () => {
      mockRbacService.getRolesForTenant.mockResolvedValueOnce({
        success: true,
        data: [{ id: 'role-1', name: 'editor' }],
      })
      mockRbacService.getEffectivePermissions.mockResolvedValueOnce({
        success: true,
        data: [{ subject: 'entries', action: 'write' }],
      })

      const res = await appWithTenant.handle(
        new Request('http://localhost/api/admin/roles/role-1')
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { success: boolean; data: { permissions: unknown[] } }
      expect(body.success).toBe(true)
      expect(body.data.permissions).toHaveLength(1)
    })
  })

  describe('POST /api/admin/roles', () => {
    it('creates custom role successfully', async () => {
      mockRbacService.createCustomRole.mockResolvedValueOnce({
        success: true,
        data: { id: 'role-new', name: 'author' },
      })

      const res = await appWithTenant.handle(
        new Request('http://localhost/api/admin/roles', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'author', description: 'Author role' }),
        })
      )

      expect(res.status).toBe(201)
      const body = (await res.json()) as { success: boolean; data: { name: string } }
      expect(body.success).toBe(true)
      expect(body.data.name).toBe('author')
    })

    it('returns 409 on role name conflict', async () => {
      mockRbacService.createCustomRole.mockResolvedValueOnce({
        success: false,
        error: { code: 'CONFLICT', message: 'Role already exists' },
      })

      const res = await appWithTenant.handle(
        new Request('http://localhost/api/admin/roles', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'author' }),
        })
      )

      expect(res.status).toBe(409)
    })
  })

  describe('PUT /api/admin/roles/:roleId', () => {
    it('updates role successfully', async () => {
      mockRbacService.updateRole.mockResolvedValueOnce({
        success: true,
        data: { id: 'role-1', name: 'senior-editor' },
      })

      const res = await appWithTenant.handle(
        new Request('http://localhost/api/admin/roles/role-1', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'senior-editor' }),
        })
      )

      expect(res.status).toBe(200)
    })

    it('returns 404 when role to update is not found', async () => {
      mockRbacService.updateRole.mockResolvedValueOnce({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Role not found' },
      })

      const res = await appWithTenant.handle(
        new Request('http://localhost/api/admin/roles/role-999', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'unknown' }),
        })
      )

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/admin/roles/:roleId', () => {
    it('deletes custom role successfully', async () => {
      mockRbacService.deleteCustomRole.mockResolvedValueOnce({
        success: true,
        data: { id: 'role-1' },
      })

      const res = await appWithTenant.handle(
        new Request('http://localhost/api/admin/roles/role-1', {
          method: 'DELETE',
        })
      )

      expect(res.status).toBe(200)
    })

    it('returns 403 when deleting built-in system role', async () => {
      mockRbacService.deleteCustomRole.mockResolvedValueOnce({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Cannot delete built-in role' },
      })

      const res = await appWithTenant.handle(
        new Request('http://localhost/api/admin/roles/role-admin', {
          method: 'DELETE',
        })
      )

      expect(res.status).toBe(403)
    })
  })

  describe('GET /api/admin/roles/:roleId/permissions', () => {
    it('returns permissions for role', async () => {
      mockRbacService.getRolesForTenant.mockResolvedValueOnce({
        success: true,
        data: [{ id: 'role-1', name: 'editor' }],
      })
      mockRbacService.getEffectivePermissions.mockResolvedValueOnce({
        success: true,
        data: [{ subject: 'entries', action: 'read' }],
      })

      const res = await appWithTenant.handle(
        new Request('http://localhost/api/admin/roles/role-1/permissions')
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as { success: boolean; data: unknown[] }
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
    })
  })
})
