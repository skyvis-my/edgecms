import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'

const { LRUMemoryCache } = await import(`../cache/memory-cache?bypass=${Date.now()}`)

describe('LRUMemoryCache', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic get/set', () => {
    it('returns null for missing key', () => {
      const cache = new LRUMemoryCache({ maxSizeBytes: 1024 })
      expect(cache.get('missing')).toBeNull()
    })

    it('stores and retrieves a value', () => {
      const cache = new LRUMemoryCache({ maxSizeBytes: 1024 })
      cache.set('key1', { title: 'Hello' }, 60)
      expect(cache.get('key1')).toEqual({ title: 'Hello' })
    })

    it('returns cloned values (not references)', () => {
      const cache = new LRUMemoryCache({ maxSizeBytes: 1024 })
      const original = { items: [1, 2, 3] }
      cache.set('key1', original, 60)
      const retrieved = cache.get('key1') as { items: number[] }
      retrieved.items.push(4)
      expect(cache.get('key1')).toEqual({ items: [1, 2, 3] })
    })
  })

  describe('TTL expiration', () => {
    it('returns null for expired entries', () => {
      const cache = new LRUMemoryCache({ maxSizeBytes: 1024 })
      cache.set('key1', 'value', 1)
      vi.useFakeTimers()
      vi.advanceTimersByTime(2000)
      expect(cache.get('key1')).toBeNull()
      vi.useRealTimers()
    })
  })

  describe('LRU eviction', () => {
    it('evicts oldest entry when size limit exceeded', () => {
      // Cache size: 30 bytes fits 2 entries (~14 bytes each), evicts on 3rd
      const cache = new LRUMemoryCache({ maxSizeBytes: 30 })
      cache.set('first', { x: 1 }, 300)
      cache.set('second', { x: 2 }, 300)
      // Third entry should evict 'first' (oldest)
      cache.set('third', { x: 3 }, 300)
      expect(cache.get('first')).toBeNull()
      expect(cache.get('second')).not.toBeNull()
      expect(cache.get('third')).not.toBeNull()
    })

    it('eviction respects size limit', () => {
      const cache = new LRUMemoryCache({ maxSizeBytes: 30 })
      // Fill cache to capacity
      cache.set('a', { x: 1 }, 300)
      cache.set('b', { x: 2 }, 300)
      expect(cache.stats().entryCount).toBe(2)
      // Adding third triggers eviction, keeping only 2 entries
      cache.set('c', { x: 3 }, 300)
      expect(cache.stats().entryCount).toBe(2)
      expect(cache.stats().sizeBytes).toBeLessThanOrEqual(30)
    })
  })

  describe('stats', () => {
    it('reports size and entry count', () => {
      const cache = new LRUMemoryCache({ maxSizeBytes: 10000 })
      cache.set('key1', { data: 'value1' }, 60)
      cache.set('key2', { data: 'value2' }, 60)
      const stats = cache.stats()
      expect(stats.entryCount).toBe(2)
      expect(stats.sizeBytes).toBeGreaterThan(0)
      expect(stats.maxSizeBytes).toBe(10000)
    })
  })

  describe('clear', () => {
    it('removes all entries', () => {
      const cache = new LRUMemoryCache({ maxSizeBytes: 1024 })
      cache.set('a', 1, 60)
      cache.set('b', 2, 60)
      cache.clear()
      expect(cache.get('a')).toBeNull()
      expect(cache.get('b')).toBeNull()
      expect(cache.stats().entryCount).toBe(0)
    })
  })
})
