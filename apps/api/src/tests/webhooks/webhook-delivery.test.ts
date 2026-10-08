import { describe, expect, it, vi } from 'bun:test'

const {
  deliverWithRetry,
  signPayload,
  calculateBackoffDelay,
} = await import(`../../webhooks/webhook-delivery.service?bypass=${Date.now()}`)

describe('webhook delivery service', () => {
  describe('deliverWithRetry', () => {
    it('retries webhook delivery with backoff', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: false, status: 500, body: 'temporary error' })
        .mockResolvedValueOnce({ success: true, status: 200, body: 'ok' })

      const result = await deliverWithRetry(deliver, {
        maxRetries: 3,
        backoffDelaySeconds: () => 0,
        wait: async () => undefined,
      })

      expect(result.attempts).toBeGreaterThan(1)
      expect(result.success).toBe(true)
    })

    it('returns on first attempt when delivery succeeds immediately', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: true, status: 200, body: 'ok' })

      const result = await deliverWithRetry(deliver, {
        maxRetries: 3,
        backoffDelaySeconds: () => 0,
        wait: async () => undefined,
      })

      expect(result.attempts).toBe(1)
      expect(result.success).toBe(true)
      expect(result.status).toBe(200)
      expect(result.body).toBe('ok')
      expect(deliver).toHaveBeenCalledTimes(1)
    })

    it('exhausts all retries when delivery always fails', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValue({ success: false, status: 503, body: 'service unavailable' })

      const result = await deliverWithRetry(deliver, {
        maxRetries: 3,
        backoffDelaySeconds: () => 0,
        wait: async () => undefined,
      })

      expect(result.attempts).toBe(3)
      expect(result.success).toBe(false)
      expect(result.status).toBe(503)
      expect(result.body).toBe('service unavailable')
      expect(deliver).toHaveBeenCalledTimes(3)
    })

    it('calls backoff between retries but not after last attempt', async () => {
      const waitFn = vi.fn<(s: number) => Promise<void>>().mockResolvedValue(undefined)
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValue({ success: false, status: 500, body: 'error' })

      await deliverWithRetry(deliver, {
        maxRetries: 3,
        backoffDelaySeconds: (attempt: number) => attempt * 10,
        wait: waitFn,
      })

      // Wait should be called between attempts, not after the final one
      expect(waitFn).toHaveBeenCalledTimes(2)
      expect(waitFn).toHaveBeenNthCalledWith(1, 10) // attempt 1
      expect(waitFn).toHaveBeenNthCalledWith(2, 20) // attempt 2
    })

    it('succeeds on the last retry attempt', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: false, status: 500, body: 'error' })
        .mockResolvedValueOnce({ success: false, status: 500, body: 'error' })
        .mockResolvedValueOnce({ success: true, status: 200, body: 'finally ok' })

      const result = await deliverWithRetry(deliver, {
        maxRetries: 3,
        backoffDelaySeconds: () => 0,
        wait: async () => undefined,
      })

      expect(result.attempts).toBe(3)
      expect(result.success).toBe(true)
      expect(result.body).toBe('finally ok')
    })

    it('handles maxRetries of 1 with no retries', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: false, status: 500, body: 'error' })

      const waitFn = vi.fn<(s: number) => Promise<void>>().mockResolvedValue(undefined)

      const result = await deliverWithRetry(deliver, {
        maxRetries: 1,
        backoffDelaySeconds: () => 0,
        wait: waitFn,
      })

      expect(result.attempts).toBe(1)
      expect(result.success).toBe(false)
      expect(deliver).toHaveBeenCalledTimes(1)
      expect(waitFn).not.toHaveBeenCalled()
    })

    it('clamps maxRetries of 0 to at least 1 attempt', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: true, status: 200, body: 'ok' })

      const result = await deliverWithRetry(deliver, {
        maxRetries: 0,
        backoffDelaySeconds: () => 0,
        wait: async () => undefined,
      })

      expect(result.attempts).toBe(1)
      expect(result.success).toBe(true)
    })

    it('preserves error response details from last failed attempt', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: false, status: 502, body: 'bad gateway' })
        .mockResolvedValueOnce({ success: false, status: 429, body: 'rate limited' })

      const result = await deliverWithRetry(deliver, {
        maxRetries: 2,
        backoffDelaySeconds: () => 0,
        wait: async () => undefined,
      })

      expect(result.success).toBe(false)
      expect(result.status).toBe(429)
      expect(result.body).toBe('rate limited')
    })

    it('clamps negative maxRetries to at least 1 attempt', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: true, status: 200, body: 'ok' })

      const result = await deliverWithRetry(deliver, {
        maxRetries: -5,
        backoffDelaySeconds: () => 0,
        wait: async () => undefined,
      })

      expect(result.attempts).toBe(1)
      expect(result.success).toBe(true)
      expect(deliver).toHaveBeenCalledTimes(1)
    })

    it('uses default backoffDelaySeconds when not provided', async () => {
      const waitFn = vi.fn<(s: number) => Promise<void>>().mockResolvedValue(undefined)
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: false, status: 500, body: 'error' })
        .mockResolvedValueOnce({ success: true, status: 200, body: 'ok' })

      await deliverWithRetry(deliver, {
        maxRetries: 2,
        wait: waitFn,
      })

      // Default backoff for attempt 1 should be calculateBackoffDelay(1) = 10
      expect(waitFn).toHaveBeenCalledTimes(1)
      expect(waitFn).toHaveBeenCalledWith(10)
    })

    it('handles deliver function that throws an error', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockRejectedValueOnce(new Error('Network timeout'))

      await expect(
        deliverWithRetry(deliver, {
          maxRetries: 3,
          backoffDelaySeconds: () => 0,
          wait: async () => undefined,
        })
      ).rejects.toThrow('Network timeout')
    })

    it('stops retrying immediately after first success even with many retries left', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: true, status: 201, body: 'created' })

      const waitFn = vi.fn<(s: number) => Promise<void>>().mockResolvedValue(undefined)

      const result = await deliverWithRetry(deliver, {
        maxRetries: 10,
        backoffDelaySeconds: () => 0,
        wait: waitFn,
      })

      expect(result.attempts).toBe(1)
      expect(result.success).toBe(true)
      expect(result.status).toBe(201)
      expect(deliver).toHaveBeenCalledTimes(1)
      expect(waitFn).not.toHaveBeenCalled()
    })

    it('handles alternating success/failure (succeeds on 2nd attempt)', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: false, status: 408, body: 'timeout' })
        .mockResolvedValueOnce({ success: true, status: 200, body: 'recovered' })

      const result = await deliverWithRetry(deliver, {
        maxRetries: 5,
        backoffDelaySeconds: () => 0,
        wait: async () => undefined,
      })

      expect(result.attempts).toBe(2)
      expect(result.success).toBe(true)
      expect(result.body).toBe('recovered')
      expect(deliver).toHaveBeenCalledTimes(2)
    })

    it('tracks status changes across retries in final result', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: false, status: 500, body: 'internal error' })
        .mockResolvedValueOnce({ success: false, status: 503, body: 'service unavailable' })
        .mockResolvedValueOnce({ success: false, status: 504, body: 'gateway timeout' })

      const result = await deliverWithRetry(deliver, {
        maxRetries: 3,
        backoffDelaySeconds: () => 0,
        wait: async () => undefined,
      })

      // Should have the last attempt's result
      expect(result.status).toBe(504)
      expect(result.body).toBe('gateway timeout')
      expect(result.attempts).toBe(3)
    })

    it('handles empty body in delivery result', async () => {
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValueOnce({ success: true, status: 204, body: '' })

      const result = await deliverWithRetry(deliver, {
        maxRetries: 3,
        backoffDelaySeconds: () => 0,
        wait: async () => undefined,
      })

      expect(result.success).toBe(true)
      expect(result.status).toBe(204)
      expect(result.body).toBe('')
      expect(result.attempts).toBe(1)
    })

    it('passes correct attempt number to backoffDelaySeconds', async () => {
      const backoffFn = vi.fn<(n: number) => number>().mockReturnValue(0)
      const deliver = vi
        .fn<() => Promise<{ success: boolean; status: number; body: string }>>()
        .mockResolvedValue({ success: false, status: 500, body: 'error' })

      await deliverWithRetry(deliver, {
        maxRetries: 4,
        backoffDelaySeconds: backoffFn,
        wait: async () => undefined,
      })

      // backoff is called between attempts, not after the last one
      expect(backoffFn).toHaveBeenCalledTimes(3)
      expect(backoffFn).toHaveBeenNthCalledWith(1, 1)
      expect(backoffFn).toHaveBeenNthCalledWith(2, 2)
      expect(backoffFn).toHaveBeenNthCalledWith(3, 3)
    })
  })

  describe('calculateBackoffDelay', () => {
    it('returns 10 seconds for first attempt', () => {
      expect(calculateBackoffDelay(1)).toBe(10)
    })

    it('returns 30 seconds for second attempt', () => {
      expect(calculateBackoffDelay(2)).toBe(30)
    })

    it('returns 90 seconds for third attempt', () => {
      expect(calculateBackoffDelay(3)).toBe(90)
    })

    it('follows exponential backoff with base 3', () => {
      // Formula: 10 * 3^(attempt - 1)
      expect(calculateBackoffDelay(4)).toBe(270)
      expect(calculateBackoffDelay(5)).toBe(810)
    })

    it('returns 2430 seconds for sixth attempt', () => {
      expect(calculateBackoffDelay(6)).toBe(2430)
    })

    it('returns correct value for attempt 0', () => {
      // 10 * 3^(-1) = 10/3 = 3.333...
      const result = calculateBackoffDelay(0)
      expect(result).toBeCloseTo(10 / 3, 5)
    })

    it('grows exponentially (each value is 3x the previous)', () => {
      for (let i = 1; i <= 5; i++) {
        const current = calculateBackoffDelay(i)
        const next = calculateBackoffDelay(i + 1)
        expect(next / current).toBe(3)
      }
    })
  })

  describe('signPayload', () => {
    it('generates HMAC-SHA256 signature headers', async () => {
      const payload = { event: 'entry.created', data: { id: '123' } }
      const secret = 'test-secret'

      const headers = await signPayload(secret, payload)

      expect(headers).toHaveProperty('x-edgecms-signature')
      expect(headers).toHaveProperty('x-webhook-signature')
      expect(headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
      expect(headers['x-webhook-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('produces matching signatures in both headers', async () => {
      const payload = { event: 'entry.updated' }
      const secret = 'shared-secret'

      const headers = await signPayload(secret, payload)

      expect(headers['x-edgecms-signature']).toBe(headers['x-webhook-signature'])
    })

    it('produces different signatures for different payloads', async () => {
      const secret = 'test-secret'

      const headers1 = await signPayload(secret, { a: 1 })
      const headers2 = await signPayload(secret, { a: 2 })

      expect(headers1['x-edgecms-signature']).not.toBe(headers2['x-edgecms-signature'])
    })

    it('produces different signatures for different secrets', async () => {
      const payload = { event: 'test' }

      const headers1 = await signPayload('secret-1', payload)
      const headers2 = await signPayload('secret-2', payload)

      expect(headers1['x-edgecms-signature']).not.toBe(headers2['x-edgecms-signature'])
    })

    it('produces deterministic signatures', async () => {
      const payload = { key: 'value' }
      const secret = 'deterministic-secret'

      const headers1 = await signPayload(secret, payload)
      const headers2 = await signPayload(secret, payload)

      expect(headers1['x-edgecms-signature']).toBe(headers2['x-edgecms-signature'])
    })

    it('handles empty object payloads', async () => {
      const headers = await signPayload('secret', {})

      expect(headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('handles nested payloads', async () => {
      const payload = {
        event: 'entry.created',
        data: {
          entry: { id: '123', fields: { title: 'Hello', nested: { deep: true } } },
        },
      }

      const headers = await signPayload('secret', payload)
      expect(headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('handles null payload', async () => {
      const headers = await signPayload('secret', null)
      expect(headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('handles string payload', async () => {
      const headers = await signPayload('secret', 'plain string')
      expect(headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('handles numeric payload', async () => {
      const headers = await signPayload('secret', 42)
      expect(headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('handles array payload', async () => {
      const headers = await signPayload('secret', [1, 2, 3])
      expect(headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('produces different signatures for different key orderings in payload', async () => {
      // JSON.stringify preserves insertion order, so different key orderings may differ
      const headers1 = await signPayload('secret', { a: 1, b: 2 })
      const headers2 = await signPayload('secret', { b: 2, a: 1 })

      // If the JSON serialization differs, signatures differ
      const json1 = JSON.stringify({ a: 1, b: 2 })
      const json2 = JSON.stringify({ b: 2, a: 1 })
      if (json1 !== json2) {
        expect(headers1['x-edgecms-signature']).not.toBe(headers2['x-edgecms-signature'])
      } else {
        expect(headers1['x-edgecms-signature']).toBe(headers2['x-edgecms-signature'])
      }
    })

    it('handles payload with special characters', async () => {
      const payload = { message: 'Hello <script>alert("xss")</script>' }
      const headers = await signPayload('secret', payload)
      expect(headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('handles payload with unicode content', async () => {
      const payload = { title: '\u3053\u3093\u306b\u3061\u306f\u4e16\u754c', emoji: '\ud83c\udf1f' }
      const headers = await signPayload('secret', payload)
      expect(headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('rejects empty string secret with a crypto error', async () => {
      await expect(signPayload('', { data: 'test' })).rejects.toThrow()
    })

    it('handles very long secret', async () => {
      const longSecret = 'a'.repeat(1024)
      const headers = await signPayload(longSecret, { data: 'test' })
      expect(headers['x-edgecms-signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('returns exactly two headers', async () => {
      const headers = await signPayload('secret', { event: 'test' })
      const keys = Object.keys(headers)
      expect(keys).toHaveLength(2)
      expect(keys).toContain('x-edgecms-signature')
      expect(keys).toContain('x-webhook-signature')
    })

    it('signature prefix is always sha256=', async () => {
      const headers = await signPayload('any-secret', { any: 'payload' })
      expect(headers['x-edgecms-signature'].startsWith('sha256=')).toBe(true)
      expect(headers['x-webhook-signature'].startsWith('sha256=')).toBe(true)
    })

    it('hex portion of signature is exactly 64 characters', async () => {
      const headers = await signPayload('secret', { event: 'test' })
      const hexPart = headers['x-edgecms-signature'].slice('sha256='.length)
      expect(hexPart).toHaveLength(64)
      // Ensure it is valid hex
      expect(hexPart).toMatch(/^[a-f0-9]+$/)
    })
  })
})
