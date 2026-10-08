import { describe, expect, it } from 'bun:test'

const { signPayload } = await import(`../../webhooks/webhook-delivery.service?bypass=${Date.now()}`)

describe('webhook signing', () => {
  it('signs webhook payload with HMAC header', async () => {
    const payload = {
      id: 'event-1',
      event: 'entry.created',
      timestamp: '2026-02-17T00:00:00.000Z',
      data: { after: { id: 'entry-1' } },
    }
    const headers = await signPayload('secret', payload)

    expect(headers['x-edgecms-signature']).toBeDefined()
    expect(headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
  })
})
