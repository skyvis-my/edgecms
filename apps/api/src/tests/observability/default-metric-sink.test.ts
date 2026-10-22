import { describe, expect, it, vi } from 'bun:test'
import { createDefaultMetricSink } from '@/observability/metrics'

function fakeKv() {
  return { put: vi.fn(async () => undefined) } as unknown as KVNamespace & {
    put: ReturnType<typeof vi.fn>
  }
}

describe('createDefaultMetricSink', () => {
  it('does not write to KV per metric increment by default', () => {
    const kv = fakeKv()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const sink = createDefaultMetricSink({ CACHE: kv })

    sink('cache_hits_total', { layer: 'memory' }, 1)

    expect(kv.put).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    log.mockRestore()
  })

  it('mirrors counters to KV only when EDGE_METRICS_KV_SINK is enabled', () => {
    const kv = fakeKv()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const sink = createDefaultMetricSink({ CACHE: kv, EDGE_METRICS_KV_SINK: 'true' })

    sink('cache_hits_total', { layer: 'memory' }, 3)

    expect(kv.put).toHaveBeenCalledTimes(1)
    expect(kv.put.mock.calls[0]?.[0]).toBe('metrics:cache_hits_total:layer=memory')
    log.mockRestore()
  })
})
