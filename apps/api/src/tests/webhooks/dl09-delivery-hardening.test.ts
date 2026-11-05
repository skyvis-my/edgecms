/**
 * DL-09 delivery hardening: timestamped HMAC signatures on real deliveries,
 * signature headers that tenant-configured headers cannot override, and SSRF
 * guards (no redirect following, blocked special-purpose address ranges).
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { drizzle } from 'drizzle-orm/d1'
import type { Env } from '@/env'
import { createMockEnv } from '../../../test-utils'
import { validateWebhookDestination } from '../../webhooks/webhook-destination-policy'
import { verifyWebhookSignature } from '../../webhooks/webhook-delivery.service'
import type { WebhookQueueMessage } from '../../webhooks/queue-producer'

const { handleQueue } = await import(`../../webhooks/queue-consumer?bypass=${Date.now()}`)

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }))

function mockOrm(headers: Record<string, string> | null = null) {
  const rows = [
    {
      id: 'webhook-1',
      tenantId: 'global',
      url: 'https://example.com/webhook',
      secret: 'test-secret',
      headers,
      enabled: true,
      retryMaxRetries: 5,
      retryTimeout: 30,
    },
  ]
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue(rows),
  }
  const insertValues: Record<string, unknown>[] = []
  return {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn((value: Record<string, unknown>) => {
        insertValues.push(value)
        return Promise.resolve(undefined)
      }),
    })),
    insertValues,
  }
}

function message(): WebhookQueueMessage {
  return {
    webhookId: 'webhook-1',
    eventPayload: {
      id: 'event-1',
      event: 'entry.created',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: { after: { id: 'entry-1' }, metadata: { syncChannel: 'global' } },
    },
    webhookUrl: 'https://example.com/webhook',
    webhookSecret: 'test-secret',
    maxRetries: 5,
    timeout: 30,
    tenantId: 'global',
  }
}

function queueMessage(body: WebhookQueueMessage) {
  return { id: 'msg-1', timestamp: new Date(), body, attempts: 0, ack: vi.fn(), retry: vi.fn() }
}

function batchOf(messages: ReturnType<typeof queueMessage>[]) {
  return {
    messages,
    queue: 'edgecms-webhook-queue',
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    retryAll: vi.fn(),
    ackAll: vi.fn(),
  } as unknown as MessageBatch<WebhookQueueMessage>
}

describe('DL-09 webhook delivery hardening', () => {
  let env: Env

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    env = createMockEnv()
  })

  it('signs real deliveries with a timestamped v1 signature receivers can verify', async () => {
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm())
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

    await handleQueue(batchOf([queueMessage(message())]), env)

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['x-edgecms-signature-v1']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/)
    expect(headers['x-edgecms-timestamp']).toMatch(/^\d+$/)
    const verdict = await verifyWebhookSignature(
      headers['x-edgecms-signature-v1'],
      'test-secret',
      JSON.parse(String(init.body))
    )
    expect(verdict).toEqual({ valid: true })
  })

  it('does not let configured custom headers override signature headers', async () => {
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockOrm({
        'X-Edgecms-Signature': 'sha256=forged',
        'x-edgecms-signature-v1': 't=1,v1=forged',
        'X-Custom': 'kept',
      })
    )
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))

    await handleQueue(batchOf([queueMessage(message())]), env)

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    const lowered = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    )
    expect(lowered['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    expect(lowered['x-edgecms-signature-v1']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/)
    expect(Object.keys(headers).filter((k) => k.toLowerCase() === 'x-edgecms-signature')).toHaveLength(1)
    expect(lowered['x-custom']).toBe('kept')
  })

  it('does not follow redirects and treats a 3xx response as a failed delivery', async () => {
    ;(drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockOrm())
    mockFetch.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })
    )
    const msg = queueMessage(message())

    await handleQueue(batchOf([msg]), env)

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.redirect).toBe('manual')
    expect(msg.retry).toHaveBeenCalledTimes(1)
    expect(msg.ack).not.toHaveBeenCalled()
  })
})

describe('DL-09 destination policy special-purpose ranges', () => {
  for (const url of [
    'https://0.0.0.0/hook',
    'https://0.1.2.3/hook',
    'https://100.64.0.1/hook',
    'https://100.127.255.254/hook',
    'https://[::]/hook',
    'https://localhost./hook',
    'https://metadata.google.internal./hook',
    'https://app.localhost/hook',
  ]) {
    it(`rejects ${url}`, () => {
      expect(validateWebhookDestination(url).valid).toBe(false)
    })
  }

  it('still accepts a public address next to the CGNAT range', () => {
    expect(validateWebhookDestination('https://100.128.0.1/hook')).toEqual({ valid: true })
  })
})
