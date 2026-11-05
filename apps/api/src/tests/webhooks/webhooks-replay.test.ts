/**
 * DL-09 replay: an operator can re-enqueue a failed delivery for a webhook
 * their tenant owns; test deliveries also obey the destination policy and
 * never follow redirects.
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import { webhooksRepository } from '../../webhooks/webhooks.repository'

vi.mock('../../webhooks/webhooks.repository', () => ({
  webhooksRepository: {
    findById: vi.fn(),
    findDeliveryById: vi.fn(),
    updateDelivery: vi.fn(),
    createDelivery: vi.fn(),
  },
}))

const { webhooksService } = await import(`../../webhooks/webhooks.service?bypass=${Date.now()}`)

type Fn = ReturnType<typeof vi.fn>
const repo = webhooksRepository as unknown as {
  findById: Fn
  findDeliveryById: Fn
  updateDelivery: Fn
  createDelivery: Fn
}
const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch
const db = {} as Database

const webhook = {
  id: 'wh-1',
  tenantId: 'tenant-a',
  url: 'https://example.com/hook',
  events: ['entry.created'],
  secret: 'secret',
  headers: null,
  enabled: true,
  retryMaxRetries: 3,
  retryBackoff: 'exponential' as const,
  retryTimeout: 30,
}

const failedDelivery = {
  id: 'del-1',
  webhookId: 'wh-1',
  eventId: 'evt-1',
  eventType: 'entry.created',
  payload: {
    id: 'evt-1',
    event: 'entry.created',
    timestamp: '2026-01-01T00:00:00.000Z',
    data: { after: { id: 'e1' }, metadata: { syncChannel: 'tenant-a' } },
  },
  status: 'failed',
  attempts: 3,
}

describe('webhooksService.replayDelivery', () => {
  const queue = { send: vi.fn(), sendBatch: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    queue.send.mockResolvedValue(undefined)
  })

  it('re-enqueues a failed delivery with the stored event and current webhook config', async () => {
    repo.findById.mockResolvedValue(webhook)
    repo.findDeliveryById.mockResolvedValue(failedDelivery)
    repo.updateDelivery.mockResolvedValue({ ...failedDelivery, status: 'pending' })

    const result = await webhooksService.replayDelivery(db, queue, 'wh-1', 'del-1', 'tenant-a')

    expect(result.success).toBe(true)
    expect(repo.findById).toHaveBeenCalledWith(db, 'wh-1', 'tenant-a')
    expect(repo.findDeliveryById).toHaveBeenCalledWith(db, 'del-1', 'wh-1')
    expect(queue.send).toHaveBeenCalledTimes(1)
    const body = queue.send.mock.calls[0]?.[0]
    expect(body).toMatchObject({
      webhookId: 'wh-1',
      webhookUrl: 'https://example.com/hook',
      tenantId: 'tenant-a',
      eventPayload: { id: 'evt-1', event: 'entry.created' },
    })
    expect(repo.updateDelivery).toHaveBeenCalledWith(
      db,
      'del-1',
      expect.objectContaining({ status: 'pending' }),
      'wh-1'
    )
  })

  it("returns NOT_FOUND for another tenant's webhook and enqueues nothing", async () => {
    repo.findById.mockResolvedValue(undefined)

    const result = await webhooksService.replayDelivery(db, queue, 'wh-1', 'del-1', 'tenant-b')

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('NOT_FOUND')
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('refuses to replay a delivery that already succeeded', async () => {
    repo.findById.mockResolvedValue(webhook)
    repo.findDeliveryById.mockResolvedValue({ ...failedDelivery, status: 'delivered' })

    const result = await webhooksService.replayDelivery(db, queue, 'wh-1', 'del-1', 'tenant-a')

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('CONFLICT')
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('refuses to replay test deliveries', async () => {
    repo.findById.mockResolvedValue(webhook)
    repo.findDeliveryById.mockResolvedValue({ ...failedDelivery, eventType: 'test' })

    const result = await webhooksService.replayDelivery(db, queue, 'wh-1', 'del-1', 'tenant-a')

    expect(result.success).toBe(false)
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('reports a clear error when no queue binding is configured', async () => {
    repo.findById.mockResolvedValue(webhook)
    repo.findDeliveryById.mockResolvedValue(failedDelivery)

    const result = await webhooksService.replayDelivery(db, undefined, 'wh-1', 'del-1', 'tenant-a')

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('QUEUE_UNAVAILABLE')
  })
})

describe('webhooksService.testDelivery SSRF guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.createDelivery.mockResolvedValue({})
  })

  it('refuses a stored destination that the current policy blocks', async () => {
    repo.findById.mockResolvedValue({ ...webhook, url: 'https://169.254.169.254/latest' })

    const result = await webhooksService.testDelivery(db, 'wh-1', 'tenant-a')

    expect(result.success).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('refuses a destination outside the allowed host list', async () => {
    repo.findById.mockResolvedValue(webhook)

    const result = await webhooksService.testDelivery(db, 'wh-1', 'tenant-a', {
      allowedHosts: ['hooks.partner.com'],
    })

    expect(result.success).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not follow redirects', async () => {
    repo.findById.mockResolvedValue(webhook)
    mockFetch.mockResolvedValue(new Response(null, { status: 302 }))

    const result = await webhooksService.testDelivery(db, 'wh-1', 'tenant-a')

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.redirect).toBe('manual')
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.success).toBe(false)
  })
})
