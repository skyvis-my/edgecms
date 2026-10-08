import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const edenGet = vi.fn()
const edenPost = vi.fn()
const mockCommandQueueAdd = vi.fn().mockResolvedValue(1)

vi.mock('@/lib/eden-client', () => ({
  edenGet,
  edenPost,
  edenPut: vi.fn(),
  edenDelete: vi.fn(),
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

describe('versioning api hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  })

  it('fetches versions list and respects disabled state for missing entry id', async () => {
    const { useVersions } = await import(`./api?bypass=${Date.now()}`)
    edenGet.mockResolvedValueOnce({
      data: [],
      meta: { pagination: { total: 0, page: 2, perPage: 10, hasMore: false } },
    })

    const { wrapper } = createWrapper()

    const disabled = renderHook(() => useVersions(''), { wrapper })
    expect(disabled.result.current.fetchStatus).toBe('idle')

    const enabled = renderHook(() => useVersions('entry_1', 2), { wrapper })
    await waitFor(() => expect(enabled.result.current.isSuccess).toBe(true))

    expect(edenGet).toHaveBeenCalledWith('/admin/entries/entry_1/versions?page=2')
  })

  it('fetches single version and version diff with enabled guards', async () => {
    const { useVersion, useVersionDiff } = await import(`./api?bypass=${Date.now()}`)
    edenGet
      .mockResolvedValueOnce({
        id: 'version_1',
        entryId: 'entry_1',
        version: 1,
        data: {},
        slug: 'hello',
        status: 'draft',
        createdAt: '2026-02-07T00:00:00.000Z',
        createdBy: null,
      })
      .mockResolvedValueOnce({
        diffs: [{ field: 'title', before: 'A', after: 'B', action: 'update' }],
      })

    const { wrapper } = createWrapper()

    const disabledVersion = renderHook(() => useVersion('entry_1', ''), { wrapper })
    expect(disabledVersion.result.current.fetchStatus).toBe('idle')

    const versionHook = renderHook(() => useVersion('entry_1', 'version_1'), { wrapper })
    await waitFor(() => expect(versionHook.result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenNthCalledWith(1, '/admin/entries/entry_1/versions/version_1')

    const disabledDiff = renderHook(() => useVersionDiff('entry_1', 'v1', ''), { wrapper })
    expect(disabledDiff.result.current.fetchStatus).toBe('idle')

    const diffHook = renderHook(() => useVersionDiff('entry_1', 'v1', 'v2'), { wrapper })
    await waitFor(() => expect(diffHook.result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenNthCalledWith(2, '/admin/entries/entry_1/versions/v1/diff/v2')
    expect(diffHook.result.current.data).toEqual([
      { field: 'title', before: 'A', after: 'B', action: 'update' },
    ])
  })

  it('rolls back a version and invalidates related caches', async () => {
    const { versionKeys, useRollback } = await import(`./api?bypass=${Date.now()}`)
    edenPost.mockResolvedValueOnce({
      id: 'version_2',
      entryId: 'entry_1',
      version: 2,
      data: {},
      slug: 'hello',
      status: 'published',
      createdAt: '2026-02-07T00:00:00.000Z',
      createdBy: null,
    })

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const hook = renderHook(() => useRollback(), { wrapper })
    await hook.result.current.mutateAsync({ entryId: 'entry_1', versionId: 'version_1' })

    expect(edenPost).toHaveBeenCalledWith('/admin/entries/entry_1/versions/version_1/rollback')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: versionKeys.lists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['entries', 'detail', 'entry_1'] })
  })

  it('queues rollback mutation offline for sync replay', async () => {
    const { useRollback } = await import(`./api?bypass=${Date.now()}`)
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useRollback(), { wrapper })

    const originalOnLine = navigator.onLine
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })

    await result.current.mutateAsync({ entryId: 'entry_1', versionId: 'version_1' })

    expect(edenPost).not.toHaveBeenCalled()
    expect(mockCommandQueueAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          type: 'httpMutation',
          payload: {
            method: 'POST',
            path: '/admin/entries/entry_1/versions/version_1/rollback',
            body: undefined,
          },
        }),
        status: 'pending',
      })
    )

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: originalOnLine })
  })
})
