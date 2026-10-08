import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const edenGet = vi.fn()
const mutateAsync = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenGet,
  edenPost: vi.fn(),
  edenPut: vi.fn(),
  edenDelete: vi.fn(),
  edenPostForTenant: vi.fn(),
  edenPostMultipart: vi.fn(),
}))

vi.mock('@/features/commands/use-execute-command', () => ({
  useExecuteCommand: () => ({
    mutateAsync,
  }),
  useDryRunCommand: () => ({
    mutateAsync: vi.fn(),
  }),
}))

// Other test files (entries.test.tsx, entry-edit.test.tsx, etc.) mock the
// entire './api/entries-api' module. In Bun's test runner, vi.mock calls
// are global and leak across files. We use a query-string suffix so Bun
// treats the import as a distinct, un-mocked module specifier while still
// resolving to the real source file (which uses our mocked edenGet and
// useExecuteCommand above).
const importEntriesApi = () => import('./api/entries-api?real')

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  return { wrapper, queryClient }
}

describe('entries api hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches entries list with query params', async () => {
    const { useEntries } = await importEntriesApi()
    edenGet.mockResolvedValueOnce({
      data: [],
      meta: { pagination: { total: 0, page: 1, perPage: 10, hasMore: false } },
    })

    const { wrapper } = createWrapper()
    const { result } = renderHook(
      () => useEntries({ collectionId: 'c1', status: 'draft', page: 2, perPage: 20 }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenCalledWith(
      '/admin/entries?collectionId=c1&status=draft&page=2&perPage=20',
    )
  })

  it('fetches entry detail and respects enabled=false for empty id', async () => {
    const { useEntry } = await importEntriesApi()
    edenGet.mockResolvedValueOnce({ id: 'e1', collectionId: 'c1' })

    const { wrapper } = createWrapper()
    const disabled = renderHook(() => useEntry(''), { wrapper })
    expect(disabled.result.current.fetchStatus).toBe('idle')
    expect(edenGet).not.toHaveBeenCalled()

    const enabled = renderHook(() => useEntry('e1'), { wrapper })
    await waitFor(() => expect(enabled.result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenCalledWith('/admin/entries/e1')
  })

  it('create/update/delete use command system and invalidate relevant keys', async () => {
    const { entriesKeys, useCreateEntry, useUpdateEntry, useDeleteEntry } =
      await importEntriesApi()

    mutateAsync
      .mockResolvedValueOnce({ data: { id: 'e1', collectionId: 'c1' } })
      .mockResolvedValueOnce({ data: { id: 'e1', collectionId: 'c1' } })
      .mockResolvedValueOnce({})

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const createHook = renderHook(() => useCreateEntry(), { wrapper })
    await createHook.result.current.mutateAsync({
      collectionId: 'c1',
      data: { title: 'A' },
      slug: 'a',
      status: 'draft',
    })
    expect(mutateAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'createEntry',
        payload: expect.objectContaining({
          collectionId: 'c1',
          data: { title: 'A' },
          slug: 'a',
          status: 'draft',
        }),
      }),
    )

    const updateHook = renderHook(() => useUpdateEntry(), { wrapper })
    await updateHook.result.current.mutateAsync({
      id: 'e1',
      input: { data: { title: 'B' } },
      optimisticVersion: 3,
    })
    expect(mutateAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'updateEntry',
        optimisticVersion: 3,
        payload: expect.objectContaining({
          entryId: 'e1',
          data: { title: 'B' },
        }),
      }),
    )

    const deleteHook = renderHook(() => useDeleteEntry(), { wrapper })
    await deleteHook.result.current.mutateAsync('e1')
    expect(mutateAsync).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'deleteEntry',
        payload: { entryId: 'e1' },
      }),
    )

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: entriesKeys.lists() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: entriesKeys.detail('e1') })
  })
})
