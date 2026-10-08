import { describe, expect, it, mock } from 'bun:test'
import { warmPublicCache } from '../../cache/cache-warming'

describe('warmPublicCache', () => {
  it('calls getCollectionList for each active collection', async () => {
    const mockDb = {} as any
    const mockKv = {} as any
    const mockCollections = [
      { id: '1', slug: 'articles', singleton: false, defaultLocale: 'en' },
      { id: '2', slug: 'settings', singleton: true, defaultLocale: 'en' },
    ]
    const mockGetCollections = mock(() => Promise.resolve(mockCollections))
    const mockGetCollectionList = mock(() => Promise.resolve({ success: true, data: {} }))
    const mockGetSingletonEntry = mock(() => Promise.resolve({ success: true, data: {} }))

    const result = await warmPublicCache({
      db: mockDb,
      kv: mockKv,
      getCollections: mockGetCollections,
      getCollectionList: mockGetCollectionList,
      getSingletonEntry: mockGetSingletonEntry,
    })

    expect(mockGetCollections).toHaveBeenCalledTimes(1)
    expect(mockGetCollectionList).toHaveBeenCalledTimes(1)
    expect(mockGetCollectionList).toHaveBeenCalledWith({
      db: mockDb,
      kv: mockKv,
      collectionSlug: 'articles',
      locale: 'en',
      page: 1,
      perPage: 20,
    })
    expect(mockGetSingletonEntry).toHaveBeenCalledTimes(1)
    expect(mockGetSingletonEntry).toHaveBeenCalledWith({
      db: mockDb,
      kv: mockKv,
      collectionSlug: 'settings',
      locale: 'en',
    })
    expect(result.warmed).toBe(2)
    expect(result.failed).toBe(0)
  })

  it('continues on individual collection failure', async () => {
    const mockDb = {} as any
    const mockKv = {} as any
    const mockCollections = [
      { id: '1', slug: 'articles', singleton: false, defaultLocale: 'en' },
      { id: '2', slug: 'pages', singleton: false, defaultLocale: 'en' },
    ]
    const mockGetCollections = mock(() => Promise.resolve(mockCollections))
    let callCount = 0
    const mockGetCollectionList = mock(() => {
      callCount++
      if (callCount === 1) return Promise.reject(new Error('fail'))
      return Promise.resolve({ success: true, data: {} })
    })
    const mockGetSingletonEntry = mock(() => Promise.resolve({ success: true, data: {} }))

    const result = await warmPublicCache({
      db: mockDb,
      kv: mockKv,
      getCollections: mockGetCollections,
      getCollectionList: mockGetCollectionList,
      getSingletonEntry: mockGetSingletonEntry,
    })

    expect(mockGetCollectionList).toHaveBeenCalledWith({
      db: mockDb,
      kv: mockKv,
      collectionSlug: 'pages',
      locale: 'en',
      page: 1,
      perPage: 20,
    })
    expect(result.warmed).toBe(1)
    expect(result.failed).toBe(1)
  })
})
