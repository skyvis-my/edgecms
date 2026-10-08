import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'

const mockFindAdminUsers = vi.fn()
const mockHasTenantContext = vi.fn(() => false)
const mockEnv = {
  DB: {} as D1Database,
  SUPER_ADMIN_EMAILS: undefined as string | undefined,
}

mock.module('cloudflare:workers', () => ({ env: mockEnv }))
mock.module('@/database/db', () => ({ createDb: vi.fn(() => ({ select: vi.fn() })) }))
mock.module('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia().macro({
    auth: {
      resolve() {
        return { user: { id: 'user-1', email: 'user@example.com', name: 'User' } }
      },
    },
  }),
}))
mock.module('@/tenants/tenant-context', () => ({
  hasTenantContext: mockHasTenantContext,
}))
mock.module('../../users/users.service', () => ({
  usersService: { findAdminUsers: mockFindAdminUsers },
}))

async function loadUsersController() {
  const module = await import(`../../users/users.controller?bypass=${Date.now()}`)
  return module.usersController
}

describe('usersController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.SUPER_ADMIN_EMAILS = undefined
    mockFindAdminUsers.mockResolvedValue([{ id: 'u1', role: 'viewer' }])
    mockHasTenantContext.mockReturnValue(false)
  })

  it('returns global user listing for authenticated users', async () => {
    const usersController = await loadUsersController()
    const app = new Elysia().use(usersController)
    const response = await app.handle(new Request('http://localhost/api/admin/users'))
    expect(response.status).toBe(200)
  })

  it('passes configured super-admin emails to service', async () => {
    mockEnv.SUPER_ADMIN_EMAILS = 'admin@example.com'
    const usersController = await loadUsersController()
    const app = new Elysia().use(usersController)
    await app.handle(new Request('http://localhost/api/admin/users'))
    expect(mockFindAdminUsers).toHaveBeenCalledWith(expect.anything(), {
      tenantId: undefined,
      superAdminEmails: ['admin@example.com'],
    })
  })

  it('forwards tenant id to service when tenant context exists', async () => {
    mockHasTenantContext.mockReturnValue(true)
    const usersController = await loadUsersController()

    const app = new Elysia()
      .derive(() => ({
        tenant: { tenant: { id: 'tenant-acme', slug: 'acme' } },
      }))
      .use(usersController)

    const response = await app.handle(new Request('http://localhost/api/admin/users'))
    expect(response.status).toBe(200)
    expect(mockFindAdminUsers).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-acme',
      superAdminEmails: [],
    })
  })
})
