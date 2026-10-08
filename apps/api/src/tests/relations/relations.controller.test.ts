import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'

const mockDb = {} as D1Database
const mockRelationsService = {
  link: vi.fn(),
  unlink: vi.fn(),
  getRelationsForEntry: vi.fn(),
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

vi.mock('../../relations/relations.service', () => ({ relationsService: mockRelationsService }))

const { relationsController } = await import(
  `../../relations/relations.controller?bypass=${Date.now()}`
)

describe('relationsController', () => {
  const app = new Elysia().use(relationsController)

  const linkBody = {
    sourceEntryId: 's1',
    targetEntryId: 't1',
    sourceCollectionId: 'c1',
    targetCollectionId: 'c2',
    relationType: 'one-to-many',
    fieldName: 'author',
  }

  beforeEach(() => vi.clearAllMocks())

  it('POST /link returns 201 on success', async () => {
    mockRelationsService.link.mockResolvedValue({ success: true, data: { id: 'r1' } })

    const response = await app.handle(
      new Request('http://localhost/api/admin/relations/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(linkBody),
      })
    )

    expect(response.status).toBe(201)
  })

  it('POST /link maps not found to 404 and validation errors to 400', async () => {
    mockRelationsService.link.mockResolvedValueOnce({
      success: false,
      error: { code: 'NOT_FOUND', message: 'x' },
    })

    const notFound = await app.handle(
      new Request('http://localhost/api/admin/relations/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(linkBody),
      })
    )
    expect(notFound.status).toBe(404)

    mockRelationsService.link.mockResolvedValueOnce({
      success: false,
      error: { code: 'DUPLICATE_RELATION', message: 'x' },
    })

    const validation = await app.handle(
      new Request('http://localhost/api/admin/relations/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(linkBody),
      })
    )
    expect(validation.status).toBe(400)
  })

  it('POST /unlink returns 404 on failure', async () => {
    mockRelationsService.unlink.mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/relations/unlink', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceEntryId: 's1', targetEntryId: 't1', fieldName: 'author' }),
      })
    )

    expect(response.status).toBe(404)
  })

  it('GET /:entryId returns data', async () => {
    mockRelationsService.getRelationsForEntry.mockResolvedValue({
      success: true,
      data: [{ id: 'r1' }],
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/relations/s1?fieldName=author')
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: [{ id: 'r1' }] })
  })
})
