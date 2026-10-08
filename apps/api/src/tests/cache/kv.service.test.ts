import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { createMockKV } from '../../../test-utils/mock-env'
import { asMockedObj } from '../../../test-utils/typed-mock'

const { kvService } = await import(`../../cache/kv.service?bypass=${Date.now()}`)

describe('kvService', () => {
  let kv: KVNamespace
  let mockKv: {
    get: ReturnType<typeof vi.fn>
    put: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    kvService.__resetInMemorySnapshotCacheForTests()
    kv = createMockKV()
    mockKv = asMockedObj(kv) as {
      get: ReturnType<typeof vi.fn>
      put: ReturnType<typeof vi.fn>
      delete: ReturnType<typeof vi.fn>
    }
  })

  describe('getCurrentVersion', () => {
    it('returns 1 when no version exists', async () => {
      const version = await kvService.getCurrentVersion(kv, 'articles', 'en')
      expect(version).toBe(1)
      expect(kv.get).toHaveBeenCalledWith('version:articles:en')
    })

    it('returns stored version number', async () => {
      // Store a version first
      await kv.put('version:articles:en', '5')

      const version = await kvService.getCurrentVersion(kv, 'articles', 'en')
      expect(version).toBe(5)
    })
  })

  describe('incrementVersion', () => {
    it('increments from default version 1 to 2', async () => {
      const newVersion = await kvService.incrementVersion(kv, 'articles', 'en')
      expect(newVersion).toBe(2)
      expect(kv.put).toHaveBeenCalledWith('version:articles:en', '2')
    })

    it('increments from existing version', async () => {
      await kv.put('version:articles:en', '3')

      const newVersion = await kvService.incrementVersion(kv, 'articles', 'en')
      expect(newVersion).toBe(4)
    })
  })

  describe('getVersionedKey', () => {
    it('generates versioned key with prefix', () => {
      const key = kvService.getVersionedKey('snapshot:articles:en:list', 1)
      expect(key).toBe('v1:snapshot:articles:en:list')
    })

    it('handles different version numbers', () => {
      const key = kvService.getVersionedKey('snapshot:articles:en:entry:hello', 42)
      expect(key).toBe('v42:snapshot:articles:en:entry:hello')
    })
  })

  describe('getSnapshot', () => {
    it('returns parsed JSON when snapshot exists', async () => {
      const data = { collection: { id: 'c1' }, entries: [] }
      await kv.put('v1:snapshot:articles:en:list', JSON.stringify(data))

      const result = await kvService.getSnapshot(kv, 'v1:snapshot:articles:en:list')
      expect(result).toEqual(data)
    })

    it('returns null when snapshot does not exist', async () => {
      const result = await kvService.getSnapshot(kv, 'nonexistent-key')
      expect(result).toBeNull()
    })

    it('returns null for invalid JSON', async () => {
      // Override get to return invalid JSON
      mockKv.get.mockResolvedValueOnce('not valid json{{{' as unknown)

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await kvService.getSnapshot(kv, 'bad-json-key')
      expect(result).toBeNull()
      consoleSpy.mockRestore()
    })

    it('prefers in-memory snapshot cache before reading KV', async () => {
      const data = { collection: { id: 'c-memory' }, entries: [{ id: 'e1' }] }
      await kvService.putSnapshot(kv, 'v1:snapshot:posts:en:list', data, 120)
      mockKv.get.mockClear()

      const result = await kvService.getSnapshot(kv, 'v1:snapshot:posts:en:list')
      expect(result).toEqual(data)
      expect(mockKv.get).not.toHaveBeenCalled()
    })
  })

  describe('putSnapshot', () => {
    it('stores serialized JSON with provided TTL', async () => {
      const data = { test: 'data' }

      await kvService.putSnapshot(kv, 'v1:snapshot:test', data, 1800)

      expect(kv.put).toHaveBeenCalledWith('v1:snapshot:test', JSON.stringify(data), {
        expirationTtl: 1800,
      })
    })

    it('clamps TTL to maximum of 3600 seconds', async () => {
      const data = { test: 'data' }

      await kvService.putSnapshot(kv, 'v1:snapshot:test', data, 7200)

      expect(kv.put).toHaveBeenCalledWith('v1:snapshot:test', JSON.stringify(data), {
        expirationTtl: 3600,
      })
    })

    it('clamps TTL to minimum of 60 seconds', async () => {
      const data = { test: 'data' }

      await kvService.putSnapshot(kv, 'v1:snapshot:test', data, 30)

      expect(kv.put).toHaveBeenCalledWith('v1:snapshot:test', JSON.stringify(data), {
        expirationTtl: 60,
      })
    })
  })

  describe('deleteSnapshot', () => {
    it('deletes the snapshot key from KV', async () => {
      await kvService.deleteSnapshot(kv, 'v1:snapshot:articles:en:list')

      expect(kv.delete).toHaveBeenCalledWith('v1:snapshot:articles:en:list')
    })
  })

  describe('per-namespace TTL', () => {
    it('accepts namespace parameter for getSnapshot', async () => {
      const { CACHE_NAMESPACE } = await import(`../../cache/cache-config?bypass=${Date.now() + 1}`)
      const data = { entries: [] }
      await kv.put('v1:snapshot:articles:en:list', JSON.stringify(data))

      // Should work with namespace parameter
      const result = await kvService.getSnapshot(
        kv,
        'v1:snapshot:articles:en:list',
        undefined,
        CACHE_NAMESPACE.COLLECTION
      )
      expect(result).toEqual(data)
    })

    it('accepts namespace parameter for putSnapshot', async () => {
      const { CACHE_NAMESPACE } = await import(`../../cache/cache-config?bypass=${Date.now() + 2}`)
      const data = { test: 'data' }

      // Should work with namespace parameter
      await kvService.putSnapshot(
        kv,
        'v1:snapshot:test',
        data,
        1800,
        CACHE_NAMESPACE.COLLECTION
      )

      expect(kv.put).toHaveBeenCalledWith('v1:snapshot:test', JSON.stringify(data), {
        expirationTtl: 1800,
      })
    })
  })
})
