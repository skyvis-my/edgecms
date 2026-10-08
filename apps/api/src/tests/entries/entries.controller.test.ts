import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'
import { asMockedObj } from '../../../test-utils/typed-mock'

const mockDb = {} as D1Database
const mockEntriesService = {
  findAllWithLocaleAndPopulate: vi.fn(),
  findByIdWithLocaleAndPopulate: vi.fn(),
  findByIds: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteById: vi.fn(),
}

vi.mock('cloudflare:workers', () => ({
  env: { DB: mockDb, CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket },
}))

vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia().macro({
    auth: {
      resolve() {
        return { user: { id: 'u1' } }
      },
    },
  }),
}))

// Re-mock tenant-context with real-like behavior so that the cache-busted
// entries controller import picks up a working hasTenantContext
mock.module('@/tenants/tenant-context', () => ({
  hasTenantContext: (ctx: unknown) => {
    return (
      typeof ctx === 'object' &&
      ctx !== null &&
      'tenant' in ctx &&
      typeof (ctx as { tenant: unknown }).tenant === 'object' &&
      (ctx as { tenant: unknown }).tenant !== null &&
      'tenant' in ((ctx as { tenant: unknown }).tenant as object) &&
      'resources' in ((ctx as { tenant: unknown }).tenant as object)
    )
  },
  resolveTenantBindings: () => ({ db: mockDb, kv: {} as KVNamespace, r2: {} as R2Bucket }),
  getTenantContext: (ctx: { tenant: unknown }) => ctx.tenant,
  verifyTenantMembership: async (db: unknown, userId: string, tenantId: string) => {
    const { tenantsRepository } = await import('../../tenants/tenants.repository')
    const membership = await tenantsRepository.findTenantUser(db as never, tenantId, userId)
    return membership?.role ?? null
  },
}))

vi.mock('../../entries/entries.service', () => ({ entriesService: mockEntriesService }))

const { entriesController } = await import(`../../entries/entries.controller?bypass=${Date.now()}`)
const mockedEntriesService = asMockedObj(mockEntriesService)

describe('entriesController', () => {
  const app = new Elysia().use(entriesController)

  beforeEach(() => vi.clearAllMocks())

  it('GET / returns pagination meta and supports populate', async () => {
    mockedEntriesService.findAllWithLocaleAndPopulate.mockResolvedValue({
      success: true,
      data: { entries: [{ id: 'e1' }], total: 1, page: 1, perPage: 20 },
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/entries?populate=author&depth=2')
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      meta: { pagination: { total: number } }
    }
    expect(body.success).toBe(true)
    expect(body.meta.pagination.total).toBe(1)
    expect(mockedEntriesService.findAllWithLocaleAndPopulate).toHaveBeenCalled()
  })

  it('GET /:entryId handles populate and service error envelope', async () => {
    mockedEntriesService.findByIdWithLocaleAndPopulate.mockResolvedValueOnce({
      success: true,
      data: { id: 'e1' },
    })

    const ok = await app.handle(
      new Request('http://localhost/api/admin/entries/e1?populate=author&depth=3')
    )
    expect(ok.status).toBe(200)

    mockedEntriesService.findByIdWithLocaleAndPopulate.mockResolvedValueOnce({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })

    const err = await app.handle(new Request('http://localhost/api/admin/entries/missing'))
    expect(err.status).toBe(200)
  })

  it('POST/PUT/DELETE map statuses correctly', async () => {
    mockedEntriesService.create.mockResolvedValueOnce({ success: true, data: { id: 'e2' } })
    const created = await app.handle(
      new Request('http://localhost/api/admin/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ collectionId: 'c1', data: {} }),
      })
    )
    expect(created.status).toBe(201)

    mockedEntriesService.create.mockResolvedValueOnce({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })
    const post404 = await app.handle(
      new Request('http://localhost/api/admin/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ collectionId: 'c1', data: {} }),
      })
    )
    expect(post404.status).toBe(404)

    mockedEntriesService.update.mockResolvedValueOnce({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'bad' },
    })
    const put400 = await app.handle(
      new Request('http://localhost/api/admin/entries/e1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      })
    )
    expect(put400.status).toBe(400)

    mockedEntriesService.deleteById.mockResolvedValueOnce({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })
    const del404 = await app.handle(
      new Request('http://localhost/api/admin/entries/e1', { method: 'DELETE' })
    )
    expect(del404.status).toBe(404)
  })

  describe('GET /batch', () => {
    it('returns 400 when no tenant context', async () => {
      const response = await app.handle(
        new Request('http://localhost/api/admin/entries/batch?ids=e1,e2')
      )
      expect(response.status).toBe(400)
      const body = (await response.json()) as { success: boolean; error: { code: string } }
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('TENANT_REQUIRED')
    })

    it('returns entries when tenant context is present', async () => {
      const tenantApp = new Elysia()
        .derive(() => ({
          tenant: {
            tenant: { id: 't1', slug: 'acme', name: 'Acme', status: 'active' },
            resources: { mode: 'shared' as const },
          },
        }))
        .use(entriesController)

      mockedEntriesService.findByIds.mockResolvedValueOnce({
        success: true,
        data: [{ id: 'e1' }, { id: 'e2' }],
      })

      const response = await tenantApp.handle(
        new Request('http://localhost/api/admin/entries/batch?ids=e1,e2')
      )
      expect(response.status).toBe(200)
      const body = (await response.json()) as { success: boolean; data: unknown[] }
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
    })

    it('returns 400 when service returns validation error', async () => {
      const tenantApp = new Elysia()
        .derive(() => ({
          tenant: {
            tenant: { id: 't1', slug: 'acme', name: 'Acme', status: 'active' },
            resources: { mode: 'shared' as const },
          },
        }))
        .use(entriesController)

      mockedEntriesService.findByIds.mockResolvedValueOnce({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Maximum 50 IDs per batch request' },
      })

      const ids = Array.from({ length: 51 }, (_, i) => `e${i}`).join(',')
      const response = await tenantApp.handle(
        new Request(`http://localhost/api/admin/entries/batch?ids=${ids}`)
      )
      expect(response.status).toBe(400)
      const body = (await response.json()) as { success: boolean; error: { code: string } }
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })
  })
})
