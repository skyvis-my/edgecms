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
}))

vi.mock('@/features/commands/use-execute-command', () => ({
  useExecuteCommand: () => ({
    mutateAsync,
  }),
  useDryRunCommand: () => ({
    mutateAsync: vi.fn(),
  }),
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

describe('relations api hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches relations by entry and by entry field', async () => {
    const { useEntryRelations } = await import('./api/relations-api')
    edenGet.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const { wrapper } = createWrapper()

    const byEntry = renderHook(() => useEntryRelations('entry_1'), { wrapper })
    await waitFor(() => expect(byEntry.result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenNthCalledWith(1, '/admin/relations/entry_1?')

    const byEntryAndField = renderHook(() => useEntryRelations('entry_1', 'relatedPosts'), {
      wrapper,
    })
    await waitFor(() => expect(byEntryAndField.result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenNthCalledWith(2, '/admin/relations/entry_1?fieldName=relatedPosts')
  })

  it('does not fetch relations when entryId is empty', async () => {
    const { useEntryRelations } = await import('./api/relations-api')

    const { wrapper } = createWrapper()
    const hook = renderHook(() => useEntryRelations(''), { wrapper })

    expect(hook.result.current.fetchStatus).toBe('idle')
    expect(edenGet).not.toHaveBeenCalled()
  })

  it('links and unlinks relations via command system with proper invalidation', async () => {
    const { entriesKeys } = await import('./api/entries-api')
    const { relationsKeys, useLinkRelation, useUnlinkRelation } = await import(
      './api/relations-api'
    )

    mutateAsync
      .mockResolvedValueOnce({
        data: {
          id: 'rel_1',
          sourceEntryId: 'entry_1',
          targetEntryId: 'entry_2',
          sourceCollectionId: 'posts',
          targetCollectionId: 'authors',
          relationType: 'one-to-many',
          fieldName: 'authors',
          sortOrder: 0,
          createdAt: '2026-02-07T00:00:00.000Z',
          updatedAt: '2026-02-07T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({})

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const linkHook = renderHook(() => useLinkRelation(), { wrapper })
    await linkHook.result.current.mutateAsync({
      sourceEntryId: 'entry_1',
      targetEntryId: 'entry_2',
      sourceCollectionId: 'posts',
      targetCollectionId: 'authors',
      relationType: 'one-to-many',
      fieldName: 'authors',
      sortOrder: 1,
    })

    expect(mutateAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'linkRelation',
        payload: expect.objectContaining({
          sourceEntryId: 'entry_1',
          targetEntryId: 'entry_2',
          sourceCollectionId: 'posts',
          targetCollectionId: 'authors',
          relationType: 'one-to-many',
          fieldName: 'authors',
          sortOrder: 1,
        }),
      })
    )

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: relationsKeys.byEntry('entry_1') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: entriesKeys.detail('entry_1') })

    const unlinkHook = renderHook(() => useUnlinkRelation(), { wrapper })
    await unlinkHook.result.current.mutateAsync({
      sourceEntryId: 'entry_1',
      targetEntryId: 'entry_2',
      fieldName: 'authors',
    })

    expect(mutateAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'unlinkRelation',
        payload: {
          sourceEntryId: 'entry_1',
          targetEntryId: 'entry_2',
          fieldName: 'authors',
        },
      })
    )

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: relationsKeys.byEntry('entry_1') })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: entriesKeys.detail('entry_1') })
  })
})
