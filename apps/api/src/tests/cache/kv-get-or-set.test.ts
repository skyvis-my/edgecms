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

  it('coalesces concurrent getOrSet calls to avoid cache stampedes', async () => {
    const mockKv = {
      get: async () => null,
      put: async () => {},
    } as unknown as KVNamespace

    let factoryCallCount = 0
    const slowFactory = async () => {
      factoryCallCount++
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { computed: 42 }
    }

    // Launch 10 concurrent getOrSet calls for the same key
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        kvService.getOrSet(mockKv, 'stampede-key', slowFactory, 300)
      )
    )

    expect(factoryCallCount).toBe(1)
    expect(results).toHaveLength(10)
    for (const res of results) {
      expect(res).toEqual({ computed: 42 })
    }
  })

  it('coalesces concurrent getSnapshot calls to a single KV read', async () => {
    let kvGetCount = 0
    const mockKv = {
      get: async () => {
        kvGetCount++
        await new Promise((resolve) => setTimeout(resolve, 20))
        return JSON.stringify({ item: 'coalesced' })
      },
      put: async () => {},
    } as unknown as KVNamespace

    // Launch 10 concurrent getSnapshot calls for the same uncached key
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        kvService.getSnapshot(mockKv, 'concurrent-snapshot-key')
      )
    )

    expect(kvGetCount).toBe(1)
    expect(results).toHaveLength(10)
    for (const res of results) {
      expect(res).toEqual({ item: 'coalesced' })
    }
  })

  it('coalesces concurrent getCurrentVersion calls to a single KV read', async () => {
    let kvGetCount = 0
    const mockKv = {
      get: async () => {
        kvGetCount++
        await new Promise((resolve) => setTimeout(resolve, 20))
        return '5'
      },
      put: async () => {},
    } as unknown as KVNamespace

    // Launch 10 concurrent getCurrentVersion calls
    const versions = await Promise.all(
      Array.from({ length: 10 }, () =>
        kvService.getCurrentVersion(mockKv, 'articles', 'en', 'tenant-1')
      )
    )

    expect(kvGetCount).toBe(1)
    expect(versions).toHaveLength(10)
    for (const ver of versions) {
      expect(ver).toBe(5)
    }
  })

  it('clears version singleflight on incrementVersion', async () => {
    let versionCounter = 1
    const mockKv = {
      get: async () => String(versionCounter),
      put: async (_key: string, value: string) => {
        versionCounter = Number(value)
      },
    } as unknown as KVNamespace

    const v1 = await kvService.getCurrentVersion(mockKv, 'news', 'en')
    expect(v1).toBe(1)

    const v2 = await kvService.incrementVersion(mockKv, 'news', 'en')
    expect(v2).toBe(2)

    const vRead = await kvService.getCurrentVersion(mockKv, 'news', 'en')
    expect(vRead).toBe(2)
  })

  it('clears snapshot singleflight on putSnapshot and deleteSnapshot', async () => {
    const store = new Map<string, string>()
    const mockKv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, val: string) => {
        store.set(key, val)
      },
      delete: async (key: string) => {
        store.delete(key)
      },
    } as unknown as KVNamespace

    await kvService.putSnapshot(mockKv, 'mut-key', { val: 'a' }, 300)
    const read1 = await kvService.getSnapshot(mockKv, 'mut-key')
    expect(read1).toEqual({ val: 'a' })

    await kvService.deleteSnapshot(mockKv, 'mut-key')
    const read2 = await kvService.getSnapshot(mockKv, 'mut-key')
    expect(read2).toBeNull()
  })
})
