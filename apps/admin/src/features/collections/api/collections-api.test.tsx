import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  collectionsKeys,
  useCollection,
  useCollectionByIdentifier,
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  useUpdateCollection,
  type CollectionDefinition,
} from './collections-api'

const mockEdenGet = vi.fn()
const mockEdenPost = vi.fn()
const mockEdenPut = vi.fn()
const mockEdenDelete = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenGet: (...args: unknown[]) => mockEdenGet(...args),
  edenPost: (...args: unknown[]) => mockEdenPost(...args),
  edenPut: (...args: unknown[]) => mockEdenPut(...args),
  edenDelete: (...args: unknown[]) => mockEdenDelete(...args),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { wrapper, queryClient }
}

const sampleCollection: CollectionDefinition = {
  id: 'col-1',
  name: 'Articles',
  slug: 'articles',
  singleton: false,
  fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
  defaultLocale: 'en',
  supportedLocales: ['en', 'fr'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('collections-api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('collectionsKeys', () => {
    it('produces consistent keys', () => {
      expect(collectionsKeys.all).toEqual(['collections'])
      expect(collectionsKeys.detail('c1')).toEqual(['collections', 'c1'])
    })
  })

  describe('useCollections', () => {
    it('fetches collections list', async () => {
      mockEdenGet.mockResolvedValueOnce([sampleCollection])
      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCollections(), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual([sampleCollection])
      expect(mockEdenGet).toHaveBeenCalledWith('/admin/collections')
    })
  })

  describe('useCollection', () => {
    it('fetches a single collection by ID', async () => {
      mockEdenGet.mockResolvedValueOnce(sampleCollection)
      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCollection('col-1'), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(sampleCollection)
      expect(mockEdenGet).toHaveBeenCalledWith('/admin/collections/col-1')
    })

    it('does not run query when id is empty', () => {
      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCollection(''), { wrapper })
      expect(result.current.fetchStatus).toBe('idle')
      expect(mockEdenGet).not.toHaveBeenCalled()
    })
  })

  describe('useCollectionByIdentifier', () => {
    it('returns collection directly when fetched by ID successfully', async () => {
      mockEdenGet.mockResolvedValueOnce(sampleCollection)
      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCollectionByIdentifier('col-1'), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(sampleCollection)
    })

    it('falls back to fetching all collections and matching slug if direct lookup fails', async () => {
      mockEdenGet
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValueOnce([sampleCollection])

      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCollectionByIdentifier('articles'), { wrapper })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(sampleCollection)
      expect(mockEdenGet).toHaveBeenCalledWith('/admin/collections/articles')
      expect(mockEdenGet).toHaveBeenCalledWith('/admin/collections')
    })

    it('throws if neither direct lookup nor slug match succeeds', async () => {
      mockEdenGet
        .mockRejectedValueOnce(new Error('Direct fail'))
        .mockResolvedValueOnce([sampleCollection])

      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCollectionByIdentifier('non-existent-slug'), { wrapper })

      await waitFor(() => expect(result.current.isError).toBe(true))
    })
  })

  describe('useCreateCollection', () => {
    it('performs online mutation and invalidates collections query', async () => {
      mockEdenPost.mockResolvedValueOnce(sampleCollection)
      const { wrapper, queryClient } = createWrapper()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const { result } = renderHook(() => useCreateCollection(), { wrapper })
      await result.current.mutateAsync({
        name: 'Articles',
        fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
      })

      expect(mockEdenPost).toHaveBeenCalledWith('/admin/collections', expect.objectContaining({ name: 'Articles' }))
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: collectionsKeys.all })
    })
  })

  describe('useUpdateCollection', () => {
    it('performs online mutation and invalidates collections and detail queries', async () => {
      mockEdenPut.mockResolvedValueOnce(sampleCollection)
      const { wrapper, queryClient } = createWrapper()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const { result } = renderHook(() => useUpdateCollection(), { wrapper })
      await result.current.mutateAsync({
        id: 'col-1',
        input: { name: 'Updated Articles' },
      })

      expect(mockEdenPut).toHaveBeenCalledWith('/admin/collections/col-1', { name: 'Updated Articles' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: collectionsKeys.all })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: collectionsKeys.detail('col-1') })
    })
  })

  describe('useDeleteCollection', () => {
    it('performs online delete mutation and invalidates collections list', async () => {
      mockEdenDelete.mockResolvedValueOnce(undefined)
      const { wrapper, queryClient } = createWrapper()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const { result } = renderHook(() => useDeleteCollection(), { wrapper })
      await result.current.mutateAsync('col-1')

      expect(mockEdenDelete).toHaveBeenCalledWith('/admin/collections/col-1')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: collectionsKeys.all })
    })
  })
})
