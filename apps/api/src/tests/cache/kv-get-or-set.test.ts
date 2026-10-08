import { describe, it, expect, beforeEach } from 'bun:test'

const { kvService } = await import(`@/cache/kv.service?bypass=${Date.now()}`)

describe('kvService.getOrSet', () => {
  beforeEach(() => {
    kvService.__resetInMemorySnapshotCacheForTests()
  })

  it('returns cached value on hit without calling factory', async () => {
    const mockKv = {
      get: async () => JSON.stringify({ cached: true }),
      put: async () => {},
    } as unknown as KVNamespace
    const factory = async () => ({ fresh: true })

    let factoryCalled = false
    const trackingFactory = async () => {
      factoryCalled = true
      return factory()
    }

    const result = await kvService.getOrSet(mockKv, 'test-key', trackingFactory, 300)
    expect(result).toEqual({ cached: true })
    expect(factoryCalled).toBe(false)
  })

  it('calls factory and stores result on miss', async () => {
    const stored: { key: string; value: string; ttl: number }[] = []
    const mockKv = {
      get: async () => null,
      put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
        stored.push({ key, value, ttl: options?.expirationTtl ?? 0 })
      },
    } as unknown as KVNamespace
    const factory = async () => ({ fresh: true })

    const result = await kvService.getOrSet(mockKv, 'test-key', factory, 300)
    expect(result).toEqual({ fresh: true })
    expect(stored).toHaveLength(1)
    expect(stored[0]!.key).toBe('test-key')
    expect(JSON.parse(stored[0]!.value)).toEqual({ fresh: true })
  })

  it('returns null when factory returns null', async () => {
    const mockKv = {
      get: async () => null,
      put: async () => {},
    } as unknown as KVNamespace
    const factory = async () => null

    const result = await kvService.getOrSet(mockKv, 'test-key', factory, 300)
    expect(result).toBeNull()
  })

  it('returns null when factory returns undefined', async () => {
    const mockKv = {
      get: async () => null,
      put: async () => {},
    } as unknown as KVNamespace
    const factory = async () => undefined as unknown as null

    const result = await kvService.getOrSet(mockKv, 'test-key', factory, 300)
    expect(result).toBeNull()
  })
})
