import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import { webhooksRepository } from '../../webhooks/webhooks.repository'

const { webhooksService } = await import(`../../webhooks/webhooks.service?bypass=${Date.now()}`)

// Mock the repository
vi.mock('../../webhooks/webhooks.repository', () => ({
  webhooksRepository: {
    findAll: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
    findDeliveries: vi.fn(),
    createDelivery: vi.fn(),
  },
}))

// Mock fetch for test delivery
const mockWebhooksRepository = webhooksRepository as unknown as {
  findAll: ReturnType<typeof vi.fn>
  findById: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  deleteById: ReturnType<typeof vi.fn>
  findDeliveries: ReturnType<typeof vi.fn>
  createDelivery: ReturnType<typeof vi.fn>
}

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

describe('webhooksService', () => {
  const mockDb = {} as Database

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset crypto.randomUUID to generate predictable IDs for testing
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'test-uuid-123' as `${string}-${string}-${string}-${string}-${string}`
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('findAll', () => {
    it('returns all webhooks', async () => {
      const mockWebhooks = [
        {
          id: '1',
          url: 'https://example.com/webhook',
          events: ['entry.created'],
          secret: 'secret123',
          headers: null,
          enabled: true,
          retryMaxRetries: 5,
          retryBackoff: 'exponential' as const,
          retryTimeout: 30,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]

      mockWebhooksRepository.findAll.mockResolvedValue(mockWebhooks)

      const result = await webhooksService.findAll(mockDb)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(mockWebhooks)
      }
      expect(mockWebhooksRepository.findAll).toHaveBeenCalledWith(mockDb)
    })
  })

  describe('findById', () => {
    it('returns webhook when found', async () => {
      const mockWebhook = {
        id: '1',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      mockWebhooksRepository.findById.mockResolvedValue(mockWebhook)

      const result = await webhooksService.findById(mockDb, '1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(mockWebhook)
      }
    })

    it('returns error when webhook not found', async () => {
      mockWebhooksRepository.findById.mockResolvedValue(undefined)

      const result = await webhooksService.findById(mockDb, 'nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
        expect(result.error.message).toContain('nonexistent')
      }
    })
  })

  describe('create', () => {
    it('creates webhook with valid HTTPS URL and events', async () => {
      const mockWebhook = {
        id: 'test-uuid-123',
        url: 'https://example.com/webhook',
        events: ['entry.created', 'entry.updated'],
        secret: expect.any(String),
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }

      mockWebhooksRepository.create.mockResolvedValue(mockWebhook)

      const result = await webhooksService.create(mockDb, {
        url: 'https://example.com/webhook',
        events: ['entry.created', 'entry.updated'],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('test-uuid-123')
        expect(result.data.url).toBe('https://example.com/webhook')
        expect(result.data.events).toEqual(['entry.created', 'entry.updated'])
        expect(result.data.secret).toBeTruthy()
        expect(result.data.enabled).toBe(true)
      }
    })

    it('rejects non-HTTPS URLs', async () => {
      const result = await webhooksService.create(mockDb, {
        url: 'http://example.com/webhook',
        events: ['entry.created'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('HTTPS')
      }
    })

    it('rejects invalid URLs', async () => {
      const result = await webhooksService.create(mockDb, {
        url: 'not-a-url',
        events: ['entry.created'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Invalid URL')
      }
    })

    it('rejects URLs containing embedded credentials', async () => {
      const result = await webhooksService.create(mockDb, {
        url: 'https://user:pass@example.com/webhook',
        events: ['entry.created'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('credentials')
      }
    })

    it('rejects non-standard HTTPS ports', async () => {
      const result = await webhooksService.create(mockDb, {
        url: 'https://example.com:8443/webhook',
        events: ['entry.created'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('port')
      }
    })

    it('enforces allowed webhook hosts policy when configured', async () => {
      const result = await webhooksService.create(
        mockDb,
        {
          url: 'https://evil.example.net/webhook',
          events: ['entry.created'],
        },
        undefined,
        { allowedHosts: ['example.com'] }
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('allowed host')
      }
    })

    it('rejects private/loopback IPv6 targets', async () => {
      const blocked = [
        'https://[::1]/webhook',
        'https://[fc00::1]/webhook',
        'https://[fd12:3456:789a::1]/webhook',
        'https://[fe80::1]/webhook',
      ]

      for (const url of blocked) {
        const result = await webhooksService.create(mockDb, {
          url,
          events: ['entry.created'],
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR')
          expect(result.error.message).toContain('private network')
        }
      }
    })

    it('rejects IPv4-mapped loopback/private IPv6 targets', async () => {
      const blocked = [
        'https://[::ffff:127.0.0.1]/webhook',
        'https://[::ffff:10.0.0.1]/webhook',
        'https://[::ffff:192.168.1.5]/webhook',
        'https://[::ffff:172.16.0.10]/webhook',
      ]

      for (const url of blocked) {
        const result = await webhooksService.create(mockDb, {
          url,
          events: ['entry.created'],
        })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR')
          expect(result.error.message).toContain('private network')
        }
      }
    })

    it('rejects empty events array', async () => {
      const result = await webhooksService.create(mockDb, {
        url: 'https://example.com/webhook',
        events: [],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('at least one event')
      }
    })

    it('rejects invalid event types', async () => {
      const result = await webhooksService.create(mockDb, {
        url: 'https://example.com/webhook',
        events: ['entry.created', 'invalid.event'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Invalid event types')
        expect(result.error.message).toContain('invalid.event')
      }
    })

    it('auto-generates secret on creation', async () => {
      const mockWebhook = {
        id: 'test-uuid-123',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'generated-secret-hex',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      mockWebhooksRepository.create.mockResolvedValue(mockWebhook)

      const result = await webhooksService.create(mockDb, {
        url: 'https://example.com/webhook',
        events: ['entry.created'],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.secret).toBeTruthy()
        expect(result.data.secret.length).toBeGreaterThan(0)
      }

      expect(mockWebhooksRepository.create).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          secret: expect.any(String),
        })
      )
    })

    it('accepts custom headers and retry config', async () => {
      const mockWebhook = {
        id: 'test-uuid-123',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: { Authorization: 'Bearer token' },
        enabled: true,
        retryMaxRetries: 3,
        retryBackoff: 'linear' as const,
        retryTimeout: 60,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      mockWebhooksRepository.create.mockResolvedValue(mockWebhook)

      const result = await webhooksService.create(mockDb, {
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        headers: { Authorization: 'Bearer token' },
        retryMaxRetries: 3,
        retryBackoff: 'linear',
        retryTimeout: 60,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.headers).toEqual({ Authorization: 'Bearer token' })
        expect(result.data.retryMaxRetries).toBe(3)
        expect(result.data.retryBackoff).toBe('linear')
        expect(result.data.retryTimeout).toBe(60)
      }
    })

    it('clamps retryMaxRetries to queue-safe maximum when creating', async () => {
      mockWebhooksRepository.create.mockResolvedValue({
        id: 'test-uuid-123',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      })

      await webhooksService.create(mockDb, {
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        retryMaxRetries: 9,
      })

      expect(mockWebhooksRepository.create).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          retryMaxRetries: 5,
        })
      )
    })
  })

  describe('update', () => {
    it('updates webhook successfully', async () => {
      const existingWebhook = {
        id: '1',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const updatedWebhook = {
        ...existingWebhook,
        enabled: false,
        updatedAt: expect.any(String),
      }

      mockWebhooksRepository.findById.mockResolvedValue(existingWebhook)
      mockWebhooksRepository.update.mockResolvedValue(updatedWebhook)

      const result = await webhooksService.update(mockDb, '1', { enabled: false })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.enabled).toBe(false)
      }
    })

    it('validates URL when updating', async () => {
      const existingWebhook = {
        id: '1',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      mockWebhooksRepository.findById.mockResolvedValue(existingWebhook)

      const result = await webhooksService.update(mockDb, '1', { url: 'http://insecure.com' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('HTTPS')
      }
    })

    it('validates events when updating', async () => {
      const existingWebhook = {
        id: '1',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      mockWebhooksRepository.findById.mockResolvedValue(existingWebhook)

      const result = await webhooksService.update(mockDb, '1', { events: ['invalid.type'] })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Invalid event types')
      }
    })

    it('returns error when webhook not found', async () => {
      mockWebhooksRepository.findById.mockResolvedValue(undefined)

      const result = await webhooksService.update(mockDb, 'nonexistent', { enabled: false })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('accepts valid url/events but returns NOT_FOUND when repository update yields no row', async () => {
      const existingWebhook = {
        id: '1',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      mockWebhooksRepository.findById.mockResolvedValue(existingWebhook)
      mockWebhooksRepository.update.mockResolvedValue(undefined)

      const result = await webhooksService.update(mockDb, '1', {
        url: 'https://valid.example.com/hook',
        events: ['entry.updated'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })

    it('clamps retryMaxRetries to queue-safe maximum when updating', async () => {
      const existingWebhook = {
        id: '1',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      mockWebhooksRepository.findById.mockResolvedValue(existingWebhook)
      mockWebhooksRepository.update.mockResolvedValue({
        ...existingWebhook,
        retryMaxRetries: 5,
        updatedAt: expect.any(String),
      })

      await webhooksService.update(mockDb, '1', { retryMaxRetries: 9 })

      expect(mockWebhooksRepository.update).toHaveBeenCalledWith(
        mockDb,
        '1',
        expect.objectContaining({
          retryMaxRetries: 5,
        })
      )
    })
  })

  describe('deleteById', () => {
    it('deletes webhook successfully', async () => {
      mockWebhooksRepository.deleteById.mockResolvedValue(true)

      const result = await webhooksService.deleteById(mockDb, '1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('1')
      }
    })

    it('returns error when webhook not found', async () => {
      mockWebhooksRepository.deleteById.mockResolvedValue(false)

      const result = await webhooksService.deleteById(mockDb, 'nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  describe('testDelivery', () => {
    it('sends test delivery and returns response', async () => {
      const mockWebhook = {
        id: '1',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      mockWebhooksRepository.findById.mockResolvedValue(mockWebhook)
      mockWebhooksRepository.createDelivery.mockResolvedValue({
        id: 'delivery-1',
        webhookId: '1',
        eventId: 'test-uuid-123',
        eventType: 'test',
        payload: { event: 'test', timestamp: expect.any(String), data: { test: true } },
        status: 'delivered',
        attempts: 1,
        lastAttemptAt: expect.any(String),
        nextRetryAt: null,
        responseStatus: 200,
        responseBody: 'OK',
        createdAt: expect.any(String),
      })

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('OK'),
      } as Response)

      const result = await webhooksService.testDelivery(mockDb, '1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.status).toBe(200)
        expect(result.data.body).toBe('OK')
        expect(result.data.success).toBe(true)
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'User-Agent': 'EdgeCMS-Webhook/1.0',
          }),
          body: expect.stringContaining('test'),
        })
      )

      expect(mockWebhooksRepository.createDelivery).toHaveBeenCalled()
    })

    it('includes custom headers in test delivery', async () => {
      const mockWebhook = {
        id: '1',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: { Authorization: 'Bearer token' },
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      mockWebhooksRepository.findById.mockResolvedValue(mockWebhook)
      mockWebhooksRepository.createDelivery.mockResolvedValue({
        id: 'delivery-1',
        webhookId: '1',
        eventId: 'test-uuid-123',
        eventType: 'test',
        payload: { event: 'test', timestamp: expect.any(String), data: { test: true } },
        status: 'delivered',
        attempts: 1,
        lastAttemptAt: expect.any(String),
        nextRetryAt: null,
        responseStatus: 200,
        responseBody: 'OK',
        createdAt: expect.any(String),
      })

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('OK'),
      } as Response)

      await webhooksService.testDelivery(mockDb, '1')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token',
          }),
        })
      )
    })

    it('handles delivery failures', async () => {
      const mockWebhook = {
        id: '1',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      mockWebhooksRepository.findById.mockResolvedValue(mockWebhook)
      mockWebhooksRepository.createDelivery.mockResolvedValue({
        id: 'delivery-1',
        webhookId: '1',
        eventId: 'test-uuid-123',
        eventType: 'test',
        payload: { event: 'test', timestamp: expect.any(String), data: { test: true } },
        status: 'failed',
        attempts: 1,
        lastAttemptAt: expect.any(String),
        nextRetryAt: null,
        responseStatus: null,
        responseBody: 'Network error',
        createdAt: expect.any(String),
      })

      mockFetch.mockRejectedValue(new Error('Network error'))

      const result = await webhooksService.testDelivery(mockDb, '1')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('DELIVERY_FAILED')
        expect(result.error.message).toContain('Network error')
      }

      expect(mockWebhooksRepository.createDelivery).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          status: 'failed',
          responseBody: 'Network error',
        })
      )
    })

    it('returns error when webhook not found', async () => {
      mockWebhooksRepository.findById.mockResolvedValue(undefined)

      const result = await webhooksService.testDelivery(mockDb, 'nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })

  describe('getDeliveries', () => {
    it('returns delivery logs for webhook', async () => {
      const mockWebhook = {
        id: '1',
        url: 'https://example.com/webhook',
        events: ['entry.created'],
        secret: 'secret123',
        headers: null,
        enabled: true,
        retryMaxRetries: 5,
        retryBackoff: 'exponential' as const,
        retryTimeout: 30,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const mockDeliveries = [
        {
          id: 'delivery-1',
          webhookId: '1',
          eventId: 'event-1',
          eventType: 'entry.created' as const,
          payload: { test: true },
          status: 'delivered' as const,
          attempts: 1,
          lastAttemptAt: '2024-01-01T00:00:00Z',
          nextRetryAt: null,
          responseStatus: 200,
          responseBody: 'OK',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]

      mockWebhooksRepository.findById.mockResolvedValue(mockWebhook)
      mockWebhooksRepository.findDeliveries.mockResolvedValue(mockDeliveries)

      const result = await webhooksService.getDeliveries(mockDb, '1')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.deliveries).toEqual(mockDeliveries)
        expect(result.data.total).toBe(1)
      }
    })

    it('returns error when webhook not found', async () => {
      mockWebhooksRepository.findById.mockResolvedValue(undefined)

      const result = await webhooksService.getDeliveries(mockDb, 'nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND')
      }
    })
  })
})
