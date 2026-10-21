import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'
import {
  resolveHostPolicies,
  type ResolvedHostPolicies,
  type TenantCreationActor,
} from '../../host/host-policies'

type ServiceSuccess<T> = { success: true; data: T }
type ServiceFailure = { success: false; error: { code: string; message: string } }

function ok<T>(data: T): ServiceSuccess<T> {
  return { success: true, data }
}

function fail(code: string, message = code): ServiceFailure {
  return { success: false, error: { code, message } }
}

const mockDb = {} as D1Database
const mockEnv = {
  DB: mockDb,
  CACHE: {} as KVNamespace,
  MEDIA: {} as R2Bucket,
  SUPER_ADMIN_EMAILS: undefined as string | undefined,
  SUPER_ADMIN_DEV_MODE: 'true' as string | undefined,
}

let mockUser: { id: string; email: string; role?: string } = { id: 'u1', email: 'admin@example.com' }

const mockService = {
  findAll: vi.fn(),
  findByIdOrSlug: vi.fn(),
  findByIdOrSlugWithUsers: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteById: vi.fn(),
  findTenantUsers: vi.fn(),
  findTenantUsersWithDetails: vi.fn(),
  addUserToTenant: vi.fn(),
  removeUserFromTenant: vi.fn(),
  updateUserRole: vi.fn(),
  // Stand-in for the real createForActor: ask the host policy, then create.
  // The service-level behavior (owner membership, events) is covered in
  // tenants.service.test.ts.
  async createForActor(
    db: unknown,
    input: unknown,
    actor: TenantCreationActor,
    host: ResolvedHostPolicies,
    lifecycle: unknown
  ) {
    createActors.push(actor)
    const decision = await host.canCreateTenant(actor)
    if (!decision.allowed) {
      return fail('FORBIDDEN', decision.reason ?? 'Tenant creation is not allowed for this account')
    }
    return mockService.create(db, input, { initialStatus: decision.initialStatus }, lifecycle)
  },
}
const createActors: TenantCreationActor[] = []

mock.module('cloudflare:workers', () => ({ env: mockEnv }))
mock.module('@/database/db', () => ({ createDb: () => mockDb }))
mock.module('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia()
    .macro({
      auth: {
        derive() {
          return { user: mockUser }
        },
      },
    })
    .onBeforeHandle(() => {}),
}))
mock.module('../../tenants/tenants.service', () => ({ tenantsService: mockService }))

const { tenantsController, createTenantsController } = await import(`../../tenants/tenants.controller?bypass=${Date.now()}`)

describe('tenantsController (repo-backed)', () => {
  const app = new Elysia().use(tenantsController)

  beforeEach(() => {
    vi.resetAllMocks()
    mockEnv.SUPER_ADMIN_EMAILS = undefined
    mockEnv.SUPER_ADMIN_DEV_MODE = 'true'
    mockUser = { id: 'u1', email: 'admin@example.com' }
    mockService.findAll.mockResolvedValue(ok([]))
    createActors.length = 0
  })

  it('GET / returns tenant list', async () => {
    mockService.findAll.mockResolvedValueOnce(ok([{ id: 't1', slug: 'acme', name: 'Acme' }]))

    const response = await app.handle(new Request('http://localhost/api/admin/tenants'))
    expect(response.status).toBe(200)
  })

  it('allows superadmin role when SUPER_ADMIN_EMAILS does not include user', async () => {
    mockEnv.SUPER_ADMIN_DEV_MODE = undefined
    mockEnv.SUPER_ADMIN_EMAILS = 'other@example.com'
    mockUser = { id: 'u1', email: 'admin@example.com', role: 'superadmin' }
    mockService.findAll.mockResolvedValueOnce(ok([{ id: 't1', slug: 'acme', name: 'Acme' }]))

    const response = await app.handle(new Request('http://localhost/api/admin/tenants'))

    expect(response.status).toBe(200)
  })

  it('GET /:tenantSlug returns tenant with users', async () => {
    mockService.findByIdOrSlugWithUsers.mockResolvedValueOnce(
      ok({
        id: 't1',
        slug: 'acme',
        name: 'Acme',
        users: [{ id: 'u1', name: 'Alice', email: 'alice@test.com', role: 'owner' }],
      })
    )

    const response = await app.handle(new Request('http://localhost/api/admin/tenants/acme'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      data: { users: { name: string }[] }
    }
    expect(body.success).toBe(true)
    expect(body.data.users).toHaveLength(1)
    expect(body.data.users[0]?.name).toBe('Alice')
  })

  it('GET /:tenantSlug returns NOT_FOUND envelope for unknown tenant', async () => {
    mockService.findByIdOrSlugWithUsers.mockResolvedValueOnce(fail('NOT_FOUND'))

    const response = await app.handle(new Request('http://localhost/api/admin/tenants/missing'))
    expect(response.status).toBe(404)
    const body = (await response.json()) as { success: boolean; error: { code: string } }
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('POST / maps create success and conflict', async () => {
    mockService.create
      .mockResolvedValueOnce(ok({ id: 't1', slug: 'acme', name: 'Acme' }))
      .mockResolvedValueOnce(fail('CONFLICT'))

    const create = await app.handle(
      new Request('http://localhost/api/admin/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Acme', slug: 'acme' }),
      })
    )
    expect(create.status).toBe(201)

    const conflict = await app.handle(
      new Request('http://localhost/api/admin/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Acme', slug: 'acme' }),
      })
    )
    expect(conflict.status).toBe(409)
  })

  it('POST / accepts localeCatalog in payload', async () => {
    mockService.create.mockResolvedValueOnce(
      ok({
        id: 'mock-uuid',
        slug: 'acme',
        name: 'Acme',
        status: 'active',
        localeCatalog: ['en', 'fr'],
      })
    )

    const create = await app.handle(
      new Request('http://localhost/api/admin/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Acme', slug: 'acme', localeCatalog: ['en', 'fr'] }),
      })
    )
    expect(create.status).toBe(201)
  })

  it('PUT /:tenantSlug maps resolution and validation statuses', async () => {
    mockService.findByIdOrSlug
      .mockResolvedValueOnce(fail('NOT_FOUND'))
      .mockResolvedValueOnce(ok({ id: 't1' }))
      .mockResolvedValueOnce(ok({ id: 't1' }))
    mockService.update
      .mockResolvedValueOnce(fail('VALIDATION_ERROR'))
      .mockResolvedValueOnce(fail('NOT_FOUND'))

    const notFound = await app.handle(
      new Request('http://localhost/api/admin/tenants/missing', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      })
    )
    expect(notFound.status).toBe(404)

    const bad = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'Bad_Slug' }),
      })
    )
    expect(bad.status).toBe(400)

    const missingAfterUpdate = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'new name' }),
      })
    )
    expect(missingAfterUpdate.status).toBe(404)
  })

  it('PUT /:tenantSlug sets requireMfa and invalidates tenant access tokens', async () => {
    const kvStore = new Map<string, string>()
    const previousCache = mockEnv.CACHE
    mockEnv.CACHE = {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => void kvStore.set(key, value)),
    } as unknown as KVNamespace
    try {
      mockService.findByIdOrSlug.mockResolvedValue(ok({ id: 't1' }))
      mockService.update.mockResolvedValue(ok({ id: 't1', requireMfa: true }))

      const response = await app.handle(
        new Request('http://localhost/api/admin/tenants/acme', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requireMfa: true }),
        })
      )
      expect(response.status).toBe(200)
      expect(mockService.update).toHaveBeenCalledWith(mockDb, 't1', { requireMfa: true })
      expect([...kvStore.keys()].some((key) => key.includes('t1'))).toBe(true)
    } finally {
      mockEnv.CACHE = previousCache
    }
  })

  it('DELETE /:tenantSlug returns success when resolved tenant is deleted', async () => {
    mockService.findByIdOrSlug.mockResolvedValueOnce(ok({ id: 't1' }))
    mockService.deleteById.mockResolvedValueOnce(ok({ id: 't1' }))

    const deleted = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme', { method: 'DELETE' })
    )
    expect(deleted.status).toBe(200)
  })

  it('DELETE /:tenantSlug maps resolve and delete failures to 404', async () => {
    mockService.findByIdOrSlug
      .mockResolvedValueOnce(fail('NOT_FOUND'))
      .mockResolvedValueOnce(ok({ id: 't1' }))
    mockService.deleteById.mockResolvedValueOnce(fail('NOT_FOUND'))

    const unresolved = await app.handle(
      new Request('http://localhost/api/admin/tenants/missing', { method: 'DELETE' })
    )
    expect(unresolved.status).toBe(404)

    const missingDelete = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme', { method: 'DELETE' })
    )
    expect(missingDelete.status).toBe(404)
  })

  it('user routes map success states', async () => {
    mockService.findByIdOrSlug.mockResolvedValue(ok({ id: 't1' }))
    mockService.findTenantUsersWithDetails.mockResolvedValueOnce(
      ok([{ id: 'u1', name: 'Alice', email: 'alice@test.com', role: 'owner' }])
    )
    mockService.addUserToTenant.mockResolvedValueOnce(ok({ tenantId: 't1', userId: 'u2' }))
    mockService.removeUserFromTenant.mockResolvedValueOnce(ok({ removed: true }))
    mockService.updateUserRole.mockResolvedValueOnce(ok({ tenantId: 't1', userId: 'u2' }))

    const users = await app.handle(new Request('http://localhost/api/admin/tenants/acme/users'))
    expect(users.status).toBe(200)
    const usersBody = (await users.json()) as {
      success: boolean
      data: { id: string; name: string; email: string; role: string }[]
    }
    expect(usersBody.data[0]?.name).toBe('Alice')
    expect(usersBody.data[0]?.email).toBe('alice@test.com')

    const add = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'u2', role: 'member' }),
      })
    )
    expect(add.status).toBe(201)

    const remove = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme/users/u2', { method: 'DELETE' })
    )
    expect(remove.status).toBe(200)

    const patch = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme/users/u2', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      })
    )
    expect(patch.status).toBe(200)
  })

  it('user routes map failure statuses', async () => {
    mockService.findByIdOrSlug
      .mockResolvedValueOnce(fail('NOT_FOUND'))
      .mockResolvedValueOnce(ok({ id: 't1' }))
      .mockResolvedValueOnce(ok({ id: 't1' }))
      .mockResolvedValueOnce(ok({ id: 't1' }))
    mockService.addUserToTenant.mockResolvedValueOnce(fail('CONFLICT'))
    mockService.removeUserFromTenant.mockResolvedValueOnce(fail('NOT_FOUND'))
    mockService.updateUserRole.mockResolvedValueOnce(fail('NOT_FOUND'))

    const users = await app.handle(new Request('http://localhost/api/admin/tenants/acme/users'))
    expect(users.status).toBe(404)

    const add = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'u2', role: 'member' }),
      })
    )
    expect(add.status).toBe(409)

    const remove = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme/users/u2', { method: 'DELETE' })
    )
    expect(remove.status).toBe(404)

    const patch = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme/users/u2', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      })
    )
    expect(patch.status).toBe(404)
  })

  it('rejects superadmin role payloads for tenant user mutations', async () => {
    mockService.findByIdOrSlug.mockResolvedValue(ok({ id: 't1' }))
    mockService.addUserToTenant.mockResolvedValueOnce(ok({ tenantId: 't1', userId: 'u2' }))
    mockService.updateUserRole.mockResolvedValueOnce(ok({ tenantId: 't1', userId: 'u2' }))

    const add = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'u2', role: 'superadmin' }),
      })
    )
    expect(add.status).toBe(422)

    const patch = await app.handle(
      new Request('http://localhost/api/admin/tenants/acme/users/u2', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'superadmin' }),
      })
    )
    expect(patch.status).toBe(422)

    expect(mockService.findByIdOrSlug).not.toHaveBeenCalled()
    expect(mockService.addUserToTenant).not.toHaveBeenCalled()
    expect(mockService.updateUserRole).not.toHaveBeenCalled()
  })

  describe('super-admin authorization', () => {
    beforeEach(() => {
      vi.resetAllMocks()
      mockService.findAll.mockResolvedValue(ok([]))
    })

    it('rejects access when SUPER_ADMIN_EMAILS is not set and dev mode is disabled', async () => {
      mockEnv.SUPER_ADMIN_EMAILS = undefined
      mockEnv.SUPER_ADMIN_DEV_MODE = undefined
      mockUser = { id: 'u1', email: 'anyone@example.com' }

      const response = await app.handle(new Request('http://localhost/api/admin/tenants'))
      expect(response.status).toBe(403)
    })

    it('allows access when SUPER_ADMIN_DEV_MODE is explicitly enabled', async () => {
      mockEnv.SUPER_ADMIN_EMAILS = undefined
      mockEnv.SUPER_ADMIN_DEV_MODE = 'true'
      mockUser = { id: 'u1', email: 'anyone@example.com' }

      const response = await app.handle(new Request('http://localhost/api/admin/tenants'))
      expect(response.status).toBe(200)
    })

    it('allows super-admin user when email is in SUPER_ADMIN_EMAILS', async () => {
      mockEnv.SUPER_ADMIN_EMAILS = 'admin@example.com,superuser@example.com'
      mockUser = { id: 'u1', email: 'admin@example.com' }

      const response = await app.handle(new Request('http://localhost/api/admin/tenants'))
      expect(response.status).toBe(200)
    })

    it('allows super-admin user with different case', async () => {
      mockEnv.SUPER_ADMIN_EMAILS = 'ADMIN@EXAMPLE.COM'
      mockUser = { id: 'u1', email: 'admin@example.com' }

      const response = await app.handle(new Request('http://localhost/api/admin/tenants'))
      expect(response.status).toBe(200)
    })

    it('rejects non-super-admin user when SUPER_ADMIN_EMAILS is set', async () => {
      mockEnv.SUPER_ADMIN_EMAILS = 'admin@example.com'
      mockUser = { id: 'u2', email: 'user@example.com' }

      const response = await app.handle(new Request('http://localhost/api/admin/tenants'))
      expect(response.status).toBe(403)
      const body = (await response.json()) as {
        success: boolean
        error: { code: string; message: string }
      }
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('FORBIDDEN')
      expect(body.error.message).toBe('Super-admin access required')
    })

    it('handles multiple super-admin emails with whitespace', async () => {
      mockEnv.SUPER_ADMIN_EMAILS = ' admin@example.com , superuser@example.com , owner@example.com '
      mockUser = { id: 'u3', email: 'owner@example.com' }

      const response = await app.handle(new Request('http://localhost/api/admin/tenants'))
      expect(response.status).toBe(200)
    })
  })

  describe('HS-02 tenant creation policy', () => {
    const createRequest = () =>
      new Request('http://localhost/api/admin/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Acme', slug: 'acme' }),
      })

    beforeEach(() => {
      mockEnv.SUPER_ADMIN_DEV_MODE = undefined
      mockEnv.SUPER_ADMIN_EMAILS = 'admin@example.com'
      mockService.create.mockResolvedValue(ok({ id: 't1', slug: 'acme', name: 'Acme' }))
    })

    it('default policy rejects a non-super-admin and creates nothing', async () => {
      mockUser = { id: 'u2', email: 'user@example.com' }

      const response = await app.handle(createRequest())

      expect(response.status).toBe(403)
      const body = (await response.json()) as { error: { code: string } }
      expect(body.error.code).toBe('FORBIDDEN')
      expect(mockService.create).not.toHaveBeenCalled()
      expect(createActors[0]).toEqual({
        userId: 'u2',
        email: 'user@example.com',
        isSuperAdmin: false,
        source: 'admin-api',
      })
    })

    it('default policy allows a super-admin', async () => {
      mockUser = { id: 'u1', email: 'admin@example.com' }

      const response = await app.handle(createRequest())

      expect(response.status).toBe(201)
      expect(createActors[0]?.isSuperAdmin).toBe(true)
    })

    it('host policy can allow non-super-admins and pick a pending initial state', async () => {
      mockUser = { id: 'u2', email: 'user@example.com' }
      const hostApp = new Elysia().use(
        createTenantsController({
          host: resolveHostPolicies({
            canCreateTenant: (actor: TenantCreationActor) =>
              actor.email.endsWith('@example.com')
                ? { allowed: true, initialStatus: 'pending' }
                : false,
          }),
        })
      )

      const response = await hostApp.handle(createRequest())

      expect(response.status).toBe(201)
      expect(mockService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ slug: 'acme' }),
        { initialStatus: 'pending' },
        expect.anything()
      )
    })

    it('host policy can deny a super-admin with its own reason', async () => {
      mockUser = { id: 'u1', email: 'admin@example.com' }
      const hostApp = new Elysia().use(
        createTenantsController({
          host: resolveHostPolicies({
            canCreateTenant: () => ({ allowed: false, reason: 'Tenant quota reached' }),
          }),
        })
      )

      const response = await hostApp.handle(createRequest())

      expect(response.status).toBe(403)
      const body = (await response.json()) as { error: { message: string } }
      expect(body.error.message).toBe('Tenant quota reached')
      expect(mockService.create).not.toHaveBeenCalled()
    })

    it('a throwing host policy fails closed', async () => {
      mockUser = { id: 'u1', email: 'admin@example.com' }
      const hostApp = new Elysia().use(
        createTenantsController({
          host: resolveHostPolicies({
            canCreateTenant: () => {
              throw new Error('billing API down')
            },
          }),
        })
      )

      const response = await hostApp.handle(createRequest())

      expect(response.status).toBe(403)
      expect(mockService.create).not.toHaveBeenCalled()
    })

    it('unauthenticated create returns 401', async () => {
      mockUser = undefined as unknown as typeof mockUser

      const response = await app.handle(createRequest())

      expect(response.status).toBe(401)
      expect(mockService.create).not.toHaveBeenCalled()
    })

    it('PUT and DELETE pass the acting user to lifecycle events', async () => {
      mockUser = { id: 'u1', email: 'admin@example.com' }
      mockService.findByIdOrSlug.mockResolvedValue(ok({ id: 't1', slug: 'acme', name: 'Acme' }))
      mockService.update.mockResolvedValueOnce(ok({ id: 't1', slug: 'acme', status: 'suspended' }))
      mockService.deleteById.mockResolvedValueOnce(ok({ id: 't1' }))

      await app.handle(
        new Request('http://localhost/api/admin/tenants/acme', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'suspended' }),
        })
      )
      await app.handle(new Request('http://localhost/api/admin/tenants/acme', { method: 'DELETE' }))

      expect(mockService.update).toHaveBeenCalledWith(
        expect.anything(),
        't1',
        { status: 'suspended' },
        expect.objectContaining({ actorId: 'u1', events: expect.anything() })
      )
      expect(mockService.deleteById).toHaveBeenCalledWith(
        expect.anything(),
        't1',
        undefined,
        expect.objectContaining({ actorId: 'u1', events: expect.anything() })
      )
    })

    it('PUT accepts the HS-04 states', async () => {
      mockUser = { id: 'u1', email: 'admin@example.com' }
      mockService.findByIdOrSlug.mockResolvedValue(ok({ id: 't1', slug: 'acme', name: 'Acme' }))
      mockService.update.mockResolvedValue(ok({ id: 't1', slug: 'acme' }))

      for (const status of ['pending', 'active', 'suspended', 'disabled']) {
        const response = await app.handle(
          new Request('http://localhost/api/admin/tenants/acme', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status }),
          })
        )
        expect(response.status).toBe(200)
      }
    })
  })
})
