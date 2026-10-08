import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { getCachedCorsOrigin, __resetCorsCacheForTests } from '../../tenants/cors-cache'

describe('getCachedCorsOrigin', () => {
  beforeEach(() => {
    __resetCorsCacheForTests()
  })

  afterEach(() => {
    __resetCorsCacheForTests()
  })

  it('calls resolver on first lookup for a tenant', async () => {
    const resolver = mock(() => Promise.resolve('https://example.com' as string | null))
    const result = await getCachedCorsOrigin('acme', resolver)
    expect(result).toBe('https://example.com')
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  it('returns cached value on subsequent lookups', async () => {
    const resolver = mock(() => Promise.resolve('https://example.com' as string | null))
    await getCachedCorsOrigin('acme', resolver)
    const result = await getCachedCorsOrigin('acme', resolver)
    expect(result).toBe('https://example.com')
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  it('caches null (no CORS configured)', async () => {
    const resolver = mock(() => Promise.resolve(null as string | null))
    await getCachedCorsOrigin('acme', resolver)
    await getCachedCorsOrigin('acme', resolver)
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  it('caches per tenant slug', async () => {
    let callCount = 0
    const resolver = mock(() => {
      callCount++
      return Promise.resolve(
        callCount === 1 ? 'https://acme.com' : 'https://beta.com'
      ) as Promise<string | null>
    })
    await getCachedCorsOrigin('acme', resolver)
    await getCachedCorsOrigin('beta', resolver)
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent in-flight resolver calls (cache stampede prevention)', async () => {
    let resolveFn: (val: string | null) => void
    const resolver = mock(
      () =>
        new Promise<string | null>((resolve) => {
          resolveFn = resolve
        })
    )

    const promise1 = getCachedCorsOrigin('acme', resolver)
    const promise2 = getCachedCorsOrigin('acme', resolver)
    const promise3 = getCachedCorsOrigin('acme', resolver)

    resolveFn!('https://acme.com')

    const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3])
    expect(r1).toBe('https://acme.com')
    expect(r2).toBe('https://acme.com')
    expect(r3).toBe('https://acme.com')
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  it('invalidates cache for a specific tenant slug', async () => {
    const { invalidateCorsCache } = await import('../../tenants/cors-cache')
    const resolver = mock(() => Promise.resolve('https://old.com' as string | null))
    await getCachedCorsOrigin('acme', resolver)
    expect(resolver).toHaveBeenCalledTimes(1)

    invalidateCorsCache('acme')

    const resolver2 = mock(() => Promise.resolve('https://new.com' as string | null))
    const result = await getCachedCorsOrigin('acme', resolver2)
    expect(result).toBe('https://new.com')
    expect(resolver2).toHaveBeenCalledTimes(1)
  })

  it('evicts oldest entry when cache reaches maximum capacity (LRU)', async () => {
    // Fill cache with 500 entries
    for (let i = 0; i < 500; i++) {
      await getCachedCorsOrigin(`tenant-${i}`, () => Promise.resolve(`https://t${i}.com`))
    }

    // Access tenant-0 to promote it to MRU
    const resolver0 = mock(() => Promise.resolve('https://promoted.com' as string | null))
    const res0 = await getCachedCorsOrigin('tenant-0', resolver0)
    expect(res0).toBe('https://t0.com')
    expect(resolver0).not.toHaveBeenCalled()

    // Add entry 501, which should evict tenant-1 (oldest non-accessed) instead of tenant-0
    await getCachedCorsOrigin('tenant-500', () => Promise.resolve('https://t500.com'))

    // tenant-0 should still be cached
    await getCachedCorsOrigin('tenant-0', resolver0)
    expect(resolver0).not.toHaveBeenCalled()

    // tenant-1 should have been evicted and require calling resolver
    const resolver1 = mock(() => Promise.resolve('https://refetched-t1.com' as string | null))
    const res1 = await getCachedCorsOrigin('tenant-1', resolver1)
    expect(res1).toBe('https://refetched-t1.com')
    expect(resolver1).toHaveBeenCalledTimes(1)
  })
})

