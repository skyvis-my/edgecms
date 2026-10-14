import { describe, expect, it } from 'bun:test'
import { LRUMemoryCache } from '../../cache/memory-cache'

describe('LRUMemoryCache O(1) LRU', () => {
  it('evicts the least-recently-used entry first', () => {
    const cache = new LRUMemoryCache({ maxSizeBytes: 100 })
    cache.setFrozen('a', { v: 'a' }, 60, 40)
    cache.setFrozen('b', { v: 'b' }, 60, 40)
    // a is now most-recently-used; b is LRU.
    expect(cache.getFrozen('a')).toEqual({ v: 'a' })
    cache.setFrozen('c', { v: 'c' }, 60, 40)

    expect(cache.getFrozen('b')).toBeNull()
    expect(cache.getFrozen('a')).toEqual({ v: 'a' })
    expect(cache.getFrozen('c')).toEqual({ v: 'c' })
  })

  it('promotes entries read via get (cloning path) as well', () => {
    const cache = new LRUMemoryCache({ maxSizeBytes: 100 })
    cache.setFrozen('a', { v: 'a' }, 60, 40)
    cache.setFrozen('b', { v: 'b' }, 60, 40)
    expect(cache.get('a')).toEqual({ v: 'a' })
    cache.setFrozen('c', { v: 'c' }, 60, 40)

    expect(cache.get('b')).toBeNull()
    expect(cache.get('a')).toEqual({ v: 'a' })
    expect(cache.get('c')).toEqual({ v: 'c' })
  })

  it('tracks size accounting across set, delete, and clear', () => {
    const cache = new LRUMemoryCache({ maxSizeBytes: 1000 })
    cache.setFrozen('a', { v: 'a' }, 60, 40)
    cache.setFrozen('b', { v: 'b' }, 60, 60)
    expect(cache.stats()).toMatchObject({ entryCount: 2, sizeBytes: 100 })

    cache.delete('a')
    expect(cache.stats()).toMatchObject({ entryCount: 1, sizeBytes: 60 })

    cache.clear()
    expect(cache.stats()).toMatchObject({ entryCount: 0, sizeBytes: 0 })
  })

  it('drops oversized entries instead of evicting the whole cache', () => {
    const cache = new LRUMemoryCache({ maxSizeBytes: 100 })
    cache.setFrozen('small', { v: 1 }, 60, 40)
    cache.setFrozen('huge', { v: 2 }, 60, 10_000)

    expect(cache.getFrozen('huge')).toBeNull()
    expect(cache.getFrozen('small')).toEqual({ v: 1 })
    expect(cache.stats().entryCount).toBe(1)
  })

  it('enforces the per-entry cap', () => {
    const cache = new LRUMemoryCache({ maxSizeBytes: 10 * 1024 * 1024, perEntryMaxBytes: 64 })
    cache.setFrozen('over-cap', { v: 1 }, 60, 65)
    expect(cache.getFrozen('over-cap')).toBeNull()
    expect(cache.stats().entryCount).toBe(0)
  })

  it('get returns an isolated clone while getFrozen returns the stored reference', () => {
    const cache = new LRUMemoryCache({ maxSizeBytes: 1000 })
    const original = { nested: { n: 1 } }
    cache.set('k', original, 60)

    const first = cache.get('k') as { nested: { n: number } }
    expect(first).toEqual(original)
    expect(first).not.toBe(original)
    first.nested.n = 99
    expect(cache.get('k')).toEqual({ nested: { n: 1 } })

    cache.setFrozen('f', original, 60, 32)
    expect(cache.getFrozen('f')).toBe(original)
  })
})
