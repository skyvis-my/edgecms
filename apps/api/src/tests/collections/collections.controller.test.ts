import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'

const mockDb = {} as D1Database
const mockCollectionsService = {
  findAll: vi.fn(),
  findByIdOrSlug: vi.fn(),
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
        return { user: { id: 'user-1' } }
      },
    },
  }),
}))

vi.mock('../../collections/collections.service', () => ({
  collectionsService: mockCollectionsService,
}))

const { collectionsController } = await import(
  `../../collections/collections.controller?bypass=${Date.now()}`
)

describe('collectionsController', () => {
  const app = new Elysia().use(collectionsController)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET / returns data on success', async () => {
    mockCollectionsService.findAll.mockResolvedValue({ success: true, data: [{ id: 'c1' }] })

    const response = await app.handle(new Request('http://localhost/api/admin/collections'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: [{ id: 'c1' }] })
  })

  it('GET /:collectionIdOrSlug returns error envelope on failure', async () => {
    mockCollectionsService.findByIdOrSlug.mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })

    const response = await app.handle(new Request('http://localhost/api/admin/collections/missing'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })
  })

  it('POST / returns 201 on success', async () => {
    mockCollectionsService.create.mockResolvedValue({ success: true, data: { id: 'c2' } })

    const response = await app.handle(
      new Request('http://localhost/api/admin/collections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Posts', fields: [] }),
      })
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ success: true, data: { id: 'c2' } })
  })

  it('POST / accepts optional slug in request body', async () => {
    mockCollectionsService.create.mockResolvedValue({ success: true, data: { id: 'c2' } })

    const response = await app.handle(
      new Request('http://localhost/api/admin/collections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Posts', slug: 'posts', fields: [] }),
      })
    )

    expect(response.status).toBe(201)
    expect(mockCollectionsService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ slug: 'posts' }),
      undefined
    )
  })

  it('POST / returns 400 on service failure', async () => {
    mockCollectionsService.create.mockResolvedValue({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'bad' },
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/collections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Posts', fields: [] }),
      })
    )

    expect(response.status).toBe(400)
  })

  it('PUT /:collectionId maps NOT_FOUND to 404', async () => {
    mockCollectionsService.update.mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/collections/missing', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      })
    )

    expect(response.status).toBe(404)
  })

  it('DELETE /:collectionId returns 404 on failure', async () => {
    mockCollectionsService.deleteById.mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/collections/missing', { method: 'DELETE' })
    )

    expect(response.status).toBe(404)
  })
})
