import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

const edenPost = vi.fn()
const edenGet = vi.fn()
const edenPatch = vi.fn()
const edenPostMultipart = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenGet,
  edenPatch,
  edenPost,
  edenPostMultipart,
  edenDelete: vi.fn(),
  edenPut: vi.fn(),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('ai api hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts prompt and context to ai command endpoint', async () => {
    const { useAiCommand } = await import('./api')
    edenPost.mockResolvedValueOnce({
      commands: [
        {
          type: 'createEntry',
          payload: { collectionId: 'posts', data: { title: 'Draft' } },
        },
      ],
      explanation: 'Created one draft entry',
    })

    const wrapper = createWrapper()
    const hook = renderHook(() => useAiCommand(), { wrapper })

    const response = await hook.result.current.mutateAsync({
      prompt: 'create a draft post',
      context: { collectionSlug: 'posts', entryId: 'entry_1' },
      dryRun: true,
    })

    expect(edenPost).toHaveBeenCalledWith('/admin/ai/command', {
      prompt: 'create a draft post',
      context: { collectionSlug: 'posts', entryId: 'entry_1' },
      dryRun: true,
    })
    expect(response.explanation).toBe('Created one draft entry')
    expect(response.commands).toHaveLength(1)
  })

  it('posts import batch lifecycle requests to dedicated AI import endpoints', async () => {
    const {
      useAnalyzeImportBatch,
      useCreateImportBatch,
      useDryRunSuggestionSet,
      useImportBatch,
      useUpdateSuggestion,
      useUploadImportSource,
    } = await import('./api')
    edenPost.mockResolvedValueOnce({ batch: { id: 'batch-1', status: 'draft', intent: 'import' } })
    edenPost.mockResolvedValueOnce({ source: { id: 'source-1', kind: 'text', extractionStatus: 'ready' } })
    edenPost.mockResolvedValueOnce({ suggestionSetId: 'set-1', status: 'ready_for_review' })
    edenPatch.mockResolvedValueOnce({ suggestion: { id: 'suggestion-1', status: 'accepted' } })
    edenPost.mockResolvedValueOnce({ commands: [], commandResults: [], validationErrors: [], dryRunHash: 'hash-1' })
    edenGet.mockResolvedValueOnce({
      batch: { id: 'batch-1', status: 'ready_for_review', intent: 'import', sourceCount: 1 },
      sources: [],
      suggestionSet: { id: 'set-1', status: 'ready' },
      suggestions: { rows: [], total: 0 },
      localeMatrix: { sourceLocale: 'en', targetLocales: [] },
      warnings: [],
    })

    const wrapper = createWrapper()
    await renderHook(() => useCreateImportBatch(), { wrapper }).result.current.mutateAsync({
      intent: 'import brochure',
      targetCollectionSlug: 'products',
      sourceLocale: 'en',
    })
    await renderHook(() => useUploadImportSource(), { wrapper }).result.current.mutateAsync({
      batchId: 'batch-1',
      text: 'source text',
    })
    await renderHook(() => useAnalyzeImportBatch(), { wrapper }).result.current.mutateAsync('batch-1')
    await renderHook(() => useUpdateSuggestion(), { wrapper }).result.current.mutateAsync({
      batchId: 'batch-1',
      suggestionId: 'suggestion-1',
      status: 'accepted',
      editedValue: 'edited',
    })
    await renderHook(() => useDryRunSuggestionSet(), { wrapper }).result.current.mutateAsync({
      batchId: 'batch-1',
      suggestionSetId: 'set-1',
    })
    renderHook(() => useImportBatch('batch-1'), { wrapper })

    expect(edenPost).toHaveBeenCalledWith('/admin/ai/import-batches', {
      intent: 'import brochure',
      targetCollectionSlug: 'products',
      sourceLocale: 'en',
    })
    expect(edenPost).toHaveBeenCalledWith('/admin/ai/import-batches/batch-1/sources', {
      kind: 'text',
      text: 'source text',
    })
    expect(edenPost).toHaveBeenCalledWith('/admin/ai/import-batches/batch-1/analyze', {})
    expect(edenPatch).toHaveBeenCalledWith('/admin/ai/suggestions/suggestion-1', {
      status: 'accepted',
      editedValue: 'edited',
    })
    expect(edenPost).toHaveBeenCalledWith('/admin/ai/suggestion-sets/set-1/dry-run', {})
  })
})
