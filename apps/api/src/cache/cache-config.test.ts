import { describe, expect, it } from 'bun:test'

const { getMemoryTTL, CACHE_NAMESPACE } = await import(
  `../cache/cache-config?bypass=${Date.now()}`
)

describe('cache-config', () => {
  describe('getMemoryTTL', () => {
    it('returns 300s for collection namespace', () => {
      expect(getMemoryTTL(CACHE_NAMESPACE.COLLECTION)).toBe(300)
    })

    it('returns 60s for content namespace', () => {
      expect(getMemoryTTL(CACHE_NAMESPACE.CONTENT)).toBe(60)
    })

    it('returns 300s for cors namespace', () => {
      expect(getMemoryTTL(CACHE_NAMESPACE.CORS)).toBe(300)
    })

    it('returns 30s for api namespace', () => {
      expect(getMemoryTTL(CACHE_NAMESPACE.API)).toBe(30)
    })
  })

  describe('CACHE_NAMESPACE', () => {
    it('has all expected namespaces', () => {
      expect(CACHE_NAMESPACE.CONTENT).toBe('content')
      expect(CACHE_NAMESPACE.COLLECTION).toBe('collection')
      expect(CACHE_NAMESPACE.CORS).toBe('cors')
      expect(CACHE_NAMESPACE.API).toBe('api')
    })
  })
})
