import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'

const mockDb = {} as D1Database
const mockWebhooksService = {
  findAll: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  deleteById: vi.fn(),
  testDelivery: vi.fn(),
  getDeliveries: vi.fn(),
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

vi.mock('../../webhooks/webhooks.service', () => ({ webhooksService: mockWebhooksService }))

const { webhooksController } = await import(
  `../../webhooks/webhooks.controller?bypass=${Date.now()}`
)

describe('webhooksController', () => {
  const app = new Elysia().use(webhooksController)

  beforeEach(() => vi.clearAllMocks())

  it('POST / returns 201 on success and 400 on failure', async () => {
    mockWebhooksService.create.mockResolvedValueOnce({ success: true, data: { id: 'w1' } })

    const created = await app.handle(
      new Request('http://localhost/api/admin/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://x.com', events: ['entry.created'] }),
      })
    )
    expect(created.status).toBe(201)

    mockWebhooksService.create.mockResolvedValueOnce({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'bad' },
    })

    const failed = await app.handle(
      new Request('http://localhost/api/admin/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'x', events: [] }),
      })
    )
    expect(failed.status).toBe(400)
  })

  it('POST / rejects retryMaxRetries values above queue maximum', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/admin/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: 'https://x.com',
          events: ['entry.created'],
          retryMaxRetries: 9,
        }),
      })
    )

    expect(response.status).toBe(422)
  })

  it('GET / and GET /:webhookId return service envelopes', async () => {
    mockWebhooksService.findAll
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: 'w1', secret: 'super-secret', url: 'https://example.com/hook', events: [] }],
      })
      .mockResolvedValueOnce({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } })
    mockWebhooksService.findById
      .mockResolvedValueOnce({
        success: true,
        data: { id: 'w1', secret: 'super-secret', url: 'https://example.com/hook', events: [] },
      })
      .mockResolvedValueOnce({ success: false, error: { code: 'NOT_FOUND', message: 'missing' } })

    const listOk = await app.handle(new Request('http://localhost/api/admin/webhooks'))
    expect(listOk.status).toBe(200)
    expect(await listOk.json()).toEqual({
      success: true,
      data: [{ id: 'w1', url: 'https://example.com/hook', events: [] }],
    })

    const listErr = await app.handle(new Request('http://localhost/api/admin/webhooks'))
    expect(listErr.status).toBe(200)
    expect(await listErr.json()).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    })

    const byIdOk = await app.handle(new Request('http://localhost/api/admin/webhooks/w1'))
    expect(byIdOk.status).toBe(200)
    expect(await byIdOk.json()).toEqual({
      success: true,
      data: { id: 'w1', url: 'https://example.com/hook', events: [] },
    })

    const byIdErr = await app.handle(new Request('http://localhost/api/admin/webhooks/missing'))
    expect(byIdErr.status).toBe(200)
    expect(await byIdErr.json()).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })
  })

  it('PUT /:webhookId maps NOT_FOUND to 404', async () => {
    mockWebhooksService.update.mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/webhooks/missing', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
    )

    expect(response.status).toBe(404)
  })

  it('PUT /:webhookId maps non-NOT_FOUND errors to 400 and success to 200', async () => {
    mockWebhooksService.update
      .mockResolvedValueOnce({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'bad' },
      })
      .mockResolvedValueOnce({ success: true, data: { id: 'w1', enabled: false } })

    const bad = await app.handle(
      new Request('http://localhost/api/admin/webhooks/w1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      })
    )
    expect(bad.status).toBe(400)

    const ok = await app.handle(
      new Request('http://localhost/api/admin/webhooks/w1', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
    )
    expect(ok.status).toBe(200)
  })

  it('DELETE /:webhookId returns 404 on failure', async () => {
    mockWebhooksService.deleteById.mockResolvedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/webhooks/missing', { method: 'DELETE' })
    )

    expect(response.status).toBe(404)
  })

  it('DELETE /:webhookId returns success envelope on success', async () => {
    mockWebhooksService.deleteById.mockResolvedValueOnce({ success: true, data: { id: 'w1' } })

    const response = await app.handle(
      new Request('http://localhost/api/admin/webhooks/w1', { method: 'DELETE' })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { id: 'w1' } })
  })

  it('POST /:webhookId/test maps NOT_FOUND to 404 and other failures to 500', async () => {
    mockWebhooksService.testDelivery.mockResolvedValueOnce({
      success: false,
      error: { code: 'NOT_FOUND', message: 'missing' },
    })

    const notFound = await app.handle(
      new Request('http://localhost/api/admin/webhooks/missing/test', { method: 'POST' })
    )
    expect(notFound.status).toBe(404)

    mockWebhooksService.testDelivery.mockResolvedValueOnce({
      success: false,
      error: { code: 'DELIVERY_FAILED', message: 'failed' },
    })

    const failure = await app.handle(
      new Request('http://localhost/api/admin/webhooks/missing/test', { method: 'POST' })
    )
    expect(failure.status).toBe(500)
  })

  it('POST /:webhookId/test returns success envelope when delivery succeeds', async () => {
    mockWebhooksService.testDelivery.mockResolvedValueOnce({
      success: true,
      data: { statusCode: 200, success: true },
    })
    const response = await app.handle(
      new Request('http://localhost/api/admin/webhooks/w1/test', { method: 'POST' })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: { statusCode: 200, success: true },
    })
  })

  it('GET /signing returns signature documentation', async () => {
    const response = await app.handle(new Request('http://localhost/api/admin/webhooks/signing'))
    const body = (await response.json()) as {
      success: boolean
      data: { headers: string[] }
    }
    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.headers).toContain('x-edgecms-signature')
  })

  it('GET /:webhookId/deliveries parses limit/offset and returns data', async () => {
    mockWebhooksService.getDeliveries.mockResolvedValue({ success: true, data: { deliveries: [] } })

    const response = await app.handle(
      new Request('http://localhost/api/admin/webhooks/w1/deliveries?limit=10&offset=5')
    )

    expect(response.status).toBe(200)
    expect(mockWebhooksService.getDeliveries).toHaveBeenCalledWith(
      expect.anything(),
      'w1',
      undefined,
      { limit: 10, offset: 5 }
    )
  })
})
