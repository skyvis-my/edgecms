import '../../../test-utils/setup'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const edenGet = vi.fn()
const edenPost = vi.fn()
const edenPostMultipart = vi.fn()
const edenPut = vi.fn()
const edenDelete = vi.fn()
const mockCommandQueueAdd = vi.fn().mockResolvedValue(1)

vi.mock('@/lib/eden-client', () => ({
  edenGet,
  edenPost,
  edenPostMultipart,
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  return { wrapper, queryClient }
}

describe('assets api hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes search query keys and honors the enabled guard', async () => {
    const { assetsKeys, useSemanticAssetSearch } = await import('./api')
    const { wrapper, queryClient } = createWrapper()

    renderHook(
      () =>
        useSemanticAssetSearch(
          { query: '  hero  ', folder: 'banners', mimeTypePrefix: 'image/' },
          false
        ),
      { wrapper }
    )

    expect(edenPost).not.toHaveBeenCalled()
    expect(
      queryClient.getQueryCache().find({
        queryKey: assetsKeys.search('hero', 'banners', 'image/'),
      })
    ).toBeDefined()

    edenPost.mockResolvedValueOnce([{ id: 'asset-1', filename: 'hero.png', mimeType: 'image/png' }])

    const enabledSearch = renderHook(
      () => useSemanticAssetSearch({ query: '  hero  ', folder: 'banners', mimeTypePrefix: 'image/' }),
      { wrapper }
    )

    await waitFor(() => expect(enabledSearch.result.current.isSuccess).toBe(true))

    expect(edenPost).toHaveBeenCalledWith('/admin/assets/search', {
      query: '  hero  ',
      folder: 'banners',
      mimeTypePrefix: 'image/',
    })
  })

  it('invalidates asset list after upload and delete mutations', async () => {
    const { assetsKeys, useDeleteAssets, useUploadAsset } = await import('./api')
    const uploadedAsset = {
      id: 'asset-1',
      filename: 'hero.png',
      mimeType: 'image/png',
      size: 123,
      variants: [],
    }

    edenPost.mockResolvedValueOnce(uploadedAsset).mockResolvedValueOnce({ deletedIds: ['asset-1'] })

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const upload = renderHook(() => useUploadAsset(), { wrapper })
    await upload.result.current.mutateAsync({
      filename: 'hero.png',
      mimeType: 'image/png',
      contentBase64: 'aGVybw==',
    })

    expect(edenPost).toHaveBeenCalledWith('/admin/assets/upload', {
      filename: 'hero.png',
      mimeType: 'image/png',
      contentBase64: 'aGVybw==',
    })

    const deleteAssets = renderHook(() => useDeleteAssets(), { wrapper })
    await deleteAssets.result.current.mutateAsync(['asset-1'])

    expect(edenPost).toHaveBeenCalledWith('/admin/assets/delete', { ids: ['asset-1'] })
    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: assetsKeys.all })
  })

  it('performs direct R2 upload with presigned intent and confirmation', async () => {
    const { assetsKeys, useDirectUploadAsset } = await import('./api')
    const { edenPost } = await import('@/lib/eden-client')

    const originalFetch = globalThis.fetch
    const mockPutFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    globalThis.fetch = mockPutFetch as any

    try {
      const intentResponse = {
        uploadUrl: 'https://r2.storage/upload-signed',
        key: 'media/photo.png',
        assetId: 'asset-direct-1',
        uploadId: 'up-123',
        expiresAt: '2026-10-28T12:00:00Z',
      }
      const completedAsset = {
        id: 'asset-direct-1',
        filename: 'photo.png',
        mimeType: 'image/png',
        size: 512,
        variants: [],
      }

      edenPost.mockResolvedValueOnce(intentResponse).mockResolvedValueOnce(completedAsset)

      const { wrapper, queryClient } = createWrapper()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const directUpload = renderHook(() => useDirectUploadAsset(), { wrapper })
      const fakeFile = new File(['dummy-content'], 'photo.png', { type: 'image/png' })

      const result = await directUpload.result.current.mutateAsync({
        file: fakeFile,
        altText: 'Hero photo',
      })

      expect(result.id).toBe('asset-direct-1')
      expect(edenPost).toHaveBeenCalledWith('/admin/assets/direct-upload-intent', expect.objectContaining({
        filename: 'photo.png',
        mimeType: 'image/png',
      }))
      expect(mockPutFetch).toHaveBeenCalledWith('https://r2.storage/upload-signed', expect.objectContaining({
        method: 'PUT',
      }))
      expect(edenPost).toHaveBeenCalledWith('/admin/assets/direct-upload-complete', expect.objectContaining({
        assetId: 'asset-direct-1',
        uploadId: 'up-123',
        key: 'media/photo.png',
      }))
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: assetsKeys.all })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
