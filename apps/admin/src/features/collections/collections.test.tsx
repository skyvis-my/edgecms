import '../../../test-utils/setup'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import type { ReactNode } from 'react'

const edenGet = vi.fn()
const edenPost = vi.fn()
const edenPut = vi.fn()
const edenDelete = vi.fn()
const mockCommandQueueAdd = vi.fn().mockResolvedValue(1)

vi.mock('@/lib/eden-client', () => ({
  edenGet,
  edenPost,
  edenPut,
  edenDelete,
}))

vi.mock('@/features/sync/offline-http-queue', () => ({
  canQueueOfflineMutation: () => true,
}))

vi.mock('@/features/sync/local-db', () => ({
  db: {
    commandQueue: {
      add: (...args: unknown[]) => mockCommandQueueAdd(...args),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(0),
        }),
      }),
    },
  },
}))

vi.mock('@/features/sync/sync-store', () => ({
  useSyncStore: {
    getState: () => ({
      refreshCounts: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

vi.mock('@/lib/tenant-storage', () => ({
  getCurrentTenantSlug: () => 'test-tenant',
  setCurrentTenantSlug: vi.fn(),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  return { wrapper, queryClient }
}

describe('collections api hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  })

  it('fetches collections with the same route and query key', async () => {
    const { collectionsKeys, useCollections } = await import(
      `./api/collections-api?bypass=${Date.now()}`
    )
    edenGet.mockResolvedValueOnce([{ id: 'c1', name: 'Posts', slug: 'posts' }])
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCollections(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: 'c1', name: 'Posts', slug: 'posts' }])
    expect(edenGet).toHaveBeenCalledWith('/admin/collections')
    expect(collectionsKeys.all).toEqual(['collections'])
  })

  it('keeps the collection empty state action-oriented', async () => {
    const tableSource = readFileSync(new URL('./components/collections-table.tsx', import.meta.url), 'utf8')

    expect(tableSource).toContain('Create a collection')
    expect(tableSource).toContain('modeling content')
  })

  it('renders the collection empty state as a next modeling action', async () => {
    const { CollectionsTable } = await import(`./components/collections-table?bypass=${Date.now()}`)

    const { getByText } = render(<CollectionsTable data={[]} />)

    expect(getByText('No collections yet. Create a collection to start modeling content.')).toBeTruthy()
  })

  it('creates collection and invalidates list query key', async () => {
    const { collectionsKeys, useCreateCollection } = await import(
      `./api/collections-api?bypass=${Date.now()}`
    )
    edenPost.mockResolvedValueOnce({ id: 'c2', name: 'Products', slug: 'products' })
    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateCollection(), { wrapper })

    await result.current.mutateAsync({
      name: 'Products',
      fields: [],
    })

    expect(edenPost).toHaveBeenCalledWith('/admin/collections', {
      name: 'Products',
      fields: [],
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: collectionsKeys.all })
  })

  it('updates and deletes collection with expected invalidations', async () => {
    const { collectionsKeys, useUpdateCollection, useDeleteCollection } = await import(
      `./api/collections-api?bypass=${Date.now()}`
    )

    edenPut.mockResolvedValueOnce({ id: 'c1', name: 'Posts 2', slug: 'posts' })
    edenDelete.mockResolvedValueOnce(undefined)

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const updateHook = renderHook(() => useUpdateCollection(), { wrapper })
    await updateHook.result.current.mutateAsync({ id: 'c1', input: { name: 'Posts 2' } })
    expect(edenPut).toHaveBeenCalledWith('/admin/collections/c1', { name: 'Posts 2' })

    const deleteHook = renderHook(() => useDeleteCollection(), { wrapper })
    await deleteHook.result.current.mutateAsync('c1')
    expect(edenDelete).toHaveBeenCalledWith('/admin/collections/c1')

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: collectionsKeys.all })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: collectionsKeys.detail('c1') })
  })

  it('queues create mutation offline for sync replay', async () => {
    const { useCreateCollection } = await import(`./api/collections-api?bypass=${Date.now()}`)
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateCollection(), { wrapper })

    const originalOnLine = navigator.onLine
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })

    await result.current.mutateAsync({
      name: 'Queued',
      fields: [],
    })

    expect(edenPost).not.toHaveBeenCalled()
    expect(mockCommandQueueAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          type: 'httpMutation',
          payload: {
            method: 'POST',
            path: '/admin/collections',
            body: {
              name: 'Queued',
              fields: [],
            },
          },
        }),
        status: 'pending',
      })
    )

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: originalOnLine })
  })
})
