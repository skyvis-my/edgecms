import { describe, expect, it } from 'bun:test'
import {
  getOrCreateRequestId,
  setRequestIdHeader,
  createTraceparentHeader,
  TRACEPARENT_REGEX,
} from '../../observability/tracing'

describe('tracing', () => {
  describe('getOrCreateRequestId', () => {
    it('extracts trace ID from W3C traceparent header', () => {
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
      const spanId = '00f067e047910b95'
      const traceparent = `00-${traceId}-${spanId}-01`
      const request = new Request('http://localhost/', {
        headers: { traceparent },
      })

      const requestId = getOrCreateRequestId(request)

      expect(requestId).toBe(traceId)
    })

    it('falls back to x-request-id when traceparent is missing', () => {
      const requestId = 'custom-request-id-123'
      const request = new Request('http://localhost/', {
        headers: { 'x-request-id': requestId },
      })

      const extracted = getOrCreateRequestId(request)

      expect(extracted).toBe(requestId)
    })

    it('falls back to generated UUID when both headers are missing', () => {
      const request = new Request('http://localhost/')

      const requestId = getOrCreateRequestId(request)

      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('prefers traceparent over x-request-id when both present', () => {
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
      const spanId = '00f067e047910b95'
      const traceparent = `00-${traceId}-${spanId}-01`
      const request = new Request('http://localhost/', {
        headers: {
          traceparent,
          'x-request-id': 'should-be-ignored',
        },
      })

      const requestId = getOrCreateRequestId(request)

      expect(requestId).toBe(traceId)
    })

    it('ignores malformed traceparent headers', () => {
      const request = new Request('http://localhost/', {
        headers: { traceparent: 'invalid-format' },
      })

      const requestId = getOrCreateRequestId(request)

      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })
  })

  describe('createTraceparentHeader', () => {
    it('generates valid W3C traceparent string', () => {
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'

      const traceparent = createTraceparentHeader(traceId)

      expect(traceparent).toMatch(TRACEPARENT_REGEX)
      expect(traceparent).toContain(traceId.replace(/-/g, '').slice(0, 32))
    })

    it('generates traceparent with correct format components', () => {
      const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'

      const traceparent = createTraceparentHeader(traceId)
      const parts = traceparent.split('-')

      expect(parts).toHaveLength(4)
      expect(parts[0]).toBe('00') // version
      expect(parts[1]).toHaveLength(32) // trace ID
      expect(parts[2]).toHaveLength(16) // span ID
      expect(parts[3]).toBe('01') // flags
    })
  })

  describe('setRequestIdHeader', () => {
    it('sets x-request-id header on response set object', () => {
      const set: { headers?: Record<string, string> } = {}
      const requestId = 'test-request-id'

      setRequestIdHeader(set, requestId)

      expect(set.headers).toEqual({ 'x-request-id': requestId })
    })
  })
})
