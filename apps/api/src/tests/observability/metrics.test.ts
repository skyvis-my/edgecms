import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { logAIRequest } from '../../ai/gateway/ai-gateway.service'
import {
  createConsoleMetricSink,
  createKvMetricSink,
  createRequestMetrics,
  getMetric,
  incrementMetric,
  metrics,
  resetMetrics,
  setMetricSink,
} from '../../observability/metrics'

describe('metrics', () => {
  beforeEach(() => {
    resetMetrics()
  })

  it('emits structured metric logs through console sink', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setMetricSink(createConsoleMetricSink())

    incrementMetric('sync_pull_total', { status: 'success' })

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"type":"metric"')
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"name":"sync_pull_total"')
    )
    logSpy.mockRestore()
  })

  it('increments counters per metric+label key', () => {
    incrementMetric('http_requests_total', { path: '/api/health', method: 'GET' })
    incrementMetric('http_requests_total', { method: 'GET', path: '/api/health' })
    incrementMetric('http_requests_total', { method: 'POST', path: '/api/health' })

    expect(getMetric('http_requests_total', { path: '/api/health', method: 'GET' })).toBe(2)
    expect(getMetric('http_requests_total', { path: '/api/health', method: 'POST' })).toBe(1)
  })

  it('does not throw when metric sink fails', () => {
    const sink = vi.fn(() => {
      throw new Error('sink unavailable')
    })
    setMetricSink(sink)

    expect(() => incrementMetric('sync_push_total', { status: 'success' })).not.toThrow()
    expect(getMetric('sync_push_total', { status: 'success' })).toBe(1)
  })

  it('increments cache hit/miss metrics via KV service', async () => {
    const { kvService } = await import(`../../cache/kv.service?bypass=${Date.now()}`)
    kvService.__resetInMemorySnapshotCacheForTests()
    const kv = {
      get: vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify({ ok: true }))
        .mockResolvedValueOnce(null),
    } as unknown as KVNamespace

    await kvService.getSnapshot(kv, 'cache-key-hit')
    await kvService.getSnapshot(kv, 'cache-key-miss')

    expect(metrics.cache_hits_total).toBe(1)
    expect(metrics.cache_misses_total).toBe(1)
    expect(metrics.cache_misses_total_memory).toBe(2)
  })

  it('tracks memory-layer cache hits when snapshot is served from in-memory cache', async () => {
    const { kvService } = await import(`../../cache/kv.service?bypass=${Date.now()}`)
    const kv = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace

    kvService.__resetInMemorySnapshotCacheForTests()
    await kvService.putSnapshot(kv, 'v1:snapshot:memory:en:list', { ok: true }, 120)
    await kvService.getSnapshot(kv, 'v1:snapshot:memory:en:list')

    expect(metrics.cache_hits_total_memory).toBe(1)
    expect(metrics.cache_misses_total).toBe(0)
  })

  it('increments AI gateway request metrics', () => {
    logAIRequest({
      promptHash: 'h1',
      modelName: 'qwen-turbo',
      timestamp: new Date().toISOString(),
    })

    expect(metrics.ai_gateway_requests_total).toBe(1)
    expect(getMetric('ai_gateway_requests_total_by_model', { model: 'qwen-turbo' })).toBe(1)
  })

  it('persists metric snapshots through KV sink', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    const kv = { put } as unknown as KVNamespace
    setMetricSink(createKvMetricSink(kv))

    incrementMetric('http_requests_total', { method: 'GET', path: '/api/health' })

    expect(put).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith(
      'metrics:http_requests_total:method=GET,path=/api/health',
      JSON.stringify({
        name: 'http_requests_total',
        labels: { method: 'GET', path: '/api/health' },
        value: 1,
      })
    )
  })
})

describe('per-request metrics', () => {
  it('createRequestMetrics returns a fresh collector', () => {
    const collector = createRequestMetrics()

    expect(collector).toBeDefined()
    expect(collector.snapshot()).toEqual(new Map())
  })

  it('collector accumulates counters across multiple increment calls', () => {
    const collector = createRequestMetrics()

    collector.increment('http_requests_total', { method: 'GET', path: '/api/health' })
    collector.increment('http_requests_total', { method: 'GET', path: '/api/health' })
    collector.increment('http_requests_total', { method: 'POST', path: '/api/health' })

    const snapshot = collector.snapshot()
    expect(snapshot.get('http_requests_total|method=GET,path=/api/health')).toBe(2)
    expect(snapshot.get('http_requests_total|method=POST,path=/api/health')).toBe(1)
  })

  it('flush writes all accumulated counters to the configured sink in one batch', () => {
    const sink = vi.fn()
    const collector = createRequestMetrics()

    collector.increment('http_requests_total', { method: 'GET', path: '/api/health' })
    collector.increment('cache_hits_total', { layer: 'kv' })
    collector.flush(sink)

    expect(sink).toHaveBeenCalledTimes(2)
    expect(sink).toHaveBeenCalledWith('http_requests_total', { method: 'GET', path: '/api/health' }, 1)
    expect(sink).toHaveBeenCalledWith('cache_hits_total', { layer: 'kv' }, 1)
  })

  it('flush resets the collector', () => {
    const sink = vi.fn()
    const collector = createRequestMetrics()

    collector.increment('http_requests_total', { method: 'GET' })
    collector.flush(sink)
    sink.mockClear()

    collector.flush(sink)

    expect(sink).not.toHaveBeenCalled()
    expect(collector.snapshot()).toEqual(new Map())
  })

  it('concurrent increments do not lose data', () => {
    const collector = createRequestMetrics()

    for (let i = 0; i < 100; i++) {
      collector.increment('concurrent_counter', { worker: String(i % 10) })
    }

    const snapshot = collector.snapshot()
    const total = Array.from(snapshot.values()).reduce((sum, val) => sum + val, 0)
    expect(total).toBe(100)
  })
})
