import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'
import { asMockedObj } from '../../../test-utils/typed-mock'

const { extractCacheTagsFromCommand, invalidateByTags } = await import(
  `../../cache/invalidation.service?bypass=${Date.now()}`
)

vi.mock('../../cache/kv.service', () => ({
  kvService: {
    incrementVersion: vi.fn().mockResolvedValue(2),
    getCurrentVersion: vi.fn().mockResolvedValue(1),
    getVersionedKey: vi.fn((baseKey: string, version: number, tenantScope?: string) =>
      tenantScope ? `${tenantScope}:v${version}:${baseKey}` : `v${version}:${baseKey}`
    ),
    getSnapshot: vi.fn().mockResolvedValue(null),
    putSnapshot: vi.fn().mockResolvedValue(undefined),
    deleteSnapshot: vi.fn().mockResolvedValue(undefined),
    __resetInMemorySnapshotCacheForTests: vi.fn(),
  },
}))

vi.mock('../../cache/snapshot.service', () => ({
  snapshotService: {
    getSnapshotKeysByTag: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: {
    findById: vi.fn(),
  },
}))

import { entriesRepository } from '@/entries/entries.repository'
import { kvService } from '../../cache/kv.service'
import { snapshotService } from '../../cache/snapshot.service'

const mockKvService = asMockedObj(kvService)
const mockSnapshotService = asMockedObj(snapshotService)
const mockEntriesRepository = asMockedObj(entriesRepository)

describe('invalidation.service', () => {
  const db = {} as Database
  let kv: KVNamespace

  beforeEach(() => {
    vi.clearAllMocks()
    kv = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace
  })

  describe('invalidateByTags', () => {
    it('returns empty when no tags provided', async () => {
      const result = await invalidateByTags(db, kv, [])
      expect(result.invalidatedKeys).toEqual([])
    })

    it('looks up snapshot keys by tag and increments version', async () => {
      mockSnapshotService.getSnapshotKeysByTag.mockResolvedValue(['snapshot:articles:en:list'])
      mockKvService.incrementVersion.mockResolvedValue(2)

      const result = await invalidateByTags(db, kv, ['collection:c1'])

      expect(mockSnapshotService.getSnapshotKeysByTag).toHaveBeenCalledWith(db, 'collection:c1')
      expect(mockKvService.incrementVersion).toHaveBeenCalledWith(kv, 'articles', 'en', undefined)
      expect(result.invalidatedKeys).toContain('snapshot:articles:en:list')
    })

    it('handles multiple tags with overlapping keys', async () => {
      mockSnapshotService.getSnapshotKeysByTag
        .mockResolvedValueOnce(['snapshot:articles:en:list', 'snapshot:articles:en:entry:hello'])
        .mockResolvedValueOnce(['snapshot:articles:en:entry:hello'])
      mockKvService.incrementVersion.mockResolvedValue(2)

      const result = await invalidateByTags(db, kv, ['collection:c1', 'entry:e1'])

      // Should deduplicate collection+locale pairs
      expect(mockKvService.incrementVersion).toHaveBeenCalledTimes(1)
      expect(result.invalidatedKeys).toHaveLength(2)
    })

    it('continues on version increment failure', async () => {
      mockSnapshotService.getSnapshotKeysByTag.mockResolvedValue(['snapshot:articles:en:list'])
      mockKvService.incrementVersion.mockRejectedValue(new Error('KV write failed'))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const result = await invalidateByTags(db, kv, ['collection:c1'])

      expect(result.invalidatedKeys).toEqual([])
      consoleSpy.mockRestore()
    })

    it('skips keys that cannot be parsed', async () => {
      mockSnapshotService.getSnapshotKeysByTag.mockResolvedValue(['invalid-key-format'])

      const result = await invalidateByTags(db, kv, ['collection:c1'])

      // No parseable key, so no version increment
      expect(mockKvService.incrementVersion).not.toHaveBeenCalled()
      expect(result.invalidatedKeys).toEqual([])
    })
  })

  describe('extractCacheTagsFromCommand', () => {
    it('extracts tags for createEntry', async () => {
      const tags = await extractCacheTagsFromCommand(db, 'createEntry', {
        collectionId: 'c1',
        entryId: 'e1',
      })
      expect(tags).toContain('collection:c1')
      expect(tags).toContain('entry:e1')
    })

    it('extracts tags for updateEntry', async () => {
      const tags = await extractCacheTagsFromCommand(db, 'updateEntry', {
        collectionId: 'c1',
        entryId: 'e1',
      })
      expect(tags).toContain('collection:c1')
      expect(tags).toContain('entry:e1')
    })

    it('extracts tags for deleteEntry', async () => {
      const tags = await extractCacheTagsFromCommand(db, 'deleteEntry', {
        collectionId: 'c1',
        entryId: 'e1',
      })
      expect(tags).toContain('collection:c1')
      expect(tags).toContain('entry:e1')
    })

    it('extracts tags for publishNow including collection tag via entry lookup', async () => {
      mockEntriesRepository.findById.mockResolvedValueOnce({ id: 'e1', collectionId: 'c1' })
      const tags = await extractCacheTagsFromCommand(db, 'publishNow', { entryId: 'e1' })
      expect(tags).toContain('entry:e1')
      expect(tags).toContain('collection:c1')
    })

    it('extracts tags for unpublishNow including collection tag via entry lookup', async () => {
      mockEntriesRepository.findById.mockResolvedValueOnce({ id: 'e1', collectionId: 'c1' })
      const tags = await extractCacheTagsFromCommand(db, 'unpublishNow', { entryId: 'e1' })
      expect(tags).toContain('entry:e1')
      expect(tags).toContain('collection:c1')
    })

    it.each(['schedulePublish', 'scheduleUnpublish', 'cancelSchedule'])(
      'extracts tags for %s including collection tag via entry lookup',
      async (commandType) => {
        mockEntriesRepository.findById.mockResolvedValueOnce({ id: 'e1', collectionId: 'c1' })
        const tags = await extractCacheTagsFromCommand(db, commandType, { entryId: 'e1' })
        expect(tags).toContain('entry:e1')
        expect(tags).toContain('collection:c1')
      }
    )

    it('uses tenant scope when resolving entry-only lifecycle tags', async () => {
      mockEntriesRepository.findById.mockResolvedValueOnce({ id: 'e1', collectionId: 'c1' })
      const tags = await extractCacheTagsFromCommand(db, 'publishNow', { entryId: 'e1' }, 'tenant-1')
      expect(mockEntriesRepository.findById).toHaveBeenCalledWith(db, 'e1', 'tenant-1')
      expect(tags).toContain('entry:e1')
      expect(tags).toContain('collection:c1')
    })

    it('uses tenant scope when resolving bulk update collection tags', async () => {
      mockEntriesRepository.findById.mockResolvedValueOnce({ id: 'e1', collectionId: 'c1' })
      const tags = await extractCacheTagsFromCommand(
        db,
        'bulkUpdate',
        { entryIds: ['e1', 'e2'], updates: { status: 'published' } },
        'tenant-1'
      )
      expect(mockEntriesRepository.findById).toHaveBeenCalledWith(db, 'e1', 'tenant-1')
      expect(tags).toContain('entry:e1')
      expect(tags).toContain('entry:e2')
      expect(tags).toContain('collection:c1')
    })

    it('extracts tags for linkRelation', async () => {
      const tags = await extractCacheTagsFromCommand(db, 'linkRelation', {
        sourceEntryId: 'e1',
        targetEntryId: 'e2',
      })
      expect(tags).toContain('entry:e1')
      expect(tags).toContain('entry:e2')
    })

    it('extracts tags for unlinkRelation', async () => {
      const tags = await extractCacheTagsFromCommand(db, 'unlinkRelation', {
        sourceEntryId: 'e1',
        targetEntryId: 'e2',
      })
      expect(tags).toContain('entry:e1')
      expect(tags).toContain('entry:e2')
    })

    it('extracts tags for updateSingleton', async () => {
      const tags = await extractCacheTagsFromCommand(db, 'updateSingleton', {
        collectionId: 'c1',
      })
      expect(tags).toContain('collection:c1')
    })

    it('extracts tags for bulkUpdate from entryIds payload', async () => {
      mockEntriesRepository.findById.mockResolvedValueOnce({ id: 'e1', collectionId: 'c1' })
      const tags = await extractCacheTagsFromCommand(db, 'bulkUpdate', {
        entryIds: ['e1', 'e2'],
        updates: { status: 'published' },
      })
      expect(tags).toContain('entry:e1')
      expect(tags).toContain('entry:e2')
      expect(tags).toContain('collection:c1')
    })

    it('returns empty tags for transaction', async () => {
      const tags = await extractCacheTagsFromCommand(db, 'transaction', {})
      expect(tags).toEqual([])
    })

    it('returns empty tags for unknown command', async () => {
      const tags = await extractCacheTagsFromCommand(db, 'unknownType', {})
      expect(tags).toEqual([])
    })

    it('handles missing payload fields gracefully', async () => {
      const tags = await extractCacheTagsFromCommand(db, 'createEntry', {})
      expect(tags).toEqual([])
    })
  })
})
