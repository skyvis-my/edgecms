import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { edenGet, edenPost, edenPostMultipart, edenPut } from '@/lib/eden-client'
import { type OfflineMutationDescriptor, useOfflineMutation } from '@/features/sync/use-offline-mutation'

export type AssetVariant = {
  id: string
  variant: string
  format: string
  width: number | null
  height: number | null
}

export type Asset = {
  id: string
  filename: string
  mimeType: string
  size: number
  createdAt?: string
  updatedAt?: string
  variants: AssetVariant[]
  semanticScore?: number
}

export const assetsKeys = {
  all: ['assets'] as const,
  detail: (id: string) => ['assets', id] as const,
  search: (query: string, folder: string, mimeTypePrefix: string) =>
    ['assets', 'search', query, folder, mimeTypePrefix] as const,
  config: ['assets', 'config'] as const,
}

export function useAssets() {
  return useQuery({
    queryKey: assetsKeys.all,
    queryFn: async () => edenGet<Asset[]>('/admin/assets'),
  })
}

export type AssetUploadConfig = {
  maxUploadBytes: number
  maxUploadDimension: number
  allowedMimeTypes: string[]
}

export function useAssetUploadConfig() {
  return useQuery({
    queryKey: assetsKeys.config,
    queryFn: async () => edenGet<AssetUploadConfig>('/admin/assets/config'),
    staleTime: 10 * 60 * 1000,
  })
}

export type SearchAssetsInput = {
  query: string
  limit?: number
  folder?: string
  mimeTypePrefix?: string
}

export function useSemanticAssetSearch(input: SearchAssetsInput, enabled = true) {
  const normalizedQuery = input.query.trim()
  return useQuery({
    queryKey: assetsKeys.search(normalizedQuery, input.folder ?? '', input.mimeTypePrefix ?? ''),
    queryFn: async () => edenPost<Asset[]>('/admin/assets/search', input),
    enabled: enabled && normalizedQuery.length > 1,
    staleTime: 15_000,
  })
}

export type UploadAssetInput = {
  filename: string
  mimeType: string
  contentBase64: string
  width?: number
  height?: number
  blurhash?: string
  variants?: Array<{
    variant: string
    format: string
    width?: number
    height?: number
    contentBase64?: string
  }>
}

export type UploadAssetMultipartInput = {
  file: File
  filename?: string
  mimeType?: string
}

function isMultipartInput(input: UploadAssetInput | UploadAssetMultipartInput): input is UploadAssetMultipartInput {
  return (input as UploadAssetMultipartInput).file instanceof File
}

function buildUploadFormData(input: UploadAssetMultipartInput): FormData {
  const formData = new FormData()
  formData.set('file', input.file)
  if (input.filename) {
    formData.set('filename', input.filename)
  }
  if (input.mimeType) {
    formData.set('mimeType', input.mimeType)
  }
  return formData
}

export function useUploadAsset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UploadAssetInput | UploadAssetMultipartInput) => {
      if (isMultipartInput(input)) {
        return edenPostMultipart<Asset>('/admin/assets/upload', buildUploadFormData(input))
      }
      return edenPost<Asset>('/admin/assets/upload', input)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: assetsKeys.all })
    },
  })
}

const updateAssetFilenameDescriptor: OfflineMutationDescriptor<{
  id: string
  filename: string
}> = {
  method: 'PUT',
  path: ({ id }) => `/admin/assets/${id}`,
  body: ({ filename }) => ({ filename }),
}

export function useUpdateAssetFilename() {
  return useOfflineMutation<Asset, { id: string; filename: string }>({
    descriptor: updateAssetFilenameDescriptor,
    runOnline: ({ id, filename }) => edenPut<Asset>(`/admin/assets/${id}`, { filename }),
    buildOfflineResult: (_queryClient, { id, filename }) => ({
      id,
      filename,
      mimeType: '',
      size: 0,
      variants: [],
    }),
    onMutationSuccess: (queryClient, updated) => {
      queryClient.invalidateQueries({ queryKey: assetsKeys.all })
      queryClient.invalidateQueries({ queryKey: assetsKeys.detail(updated.id) })
    },
  })
}

const deleteAssetsDescriptor: OfflineMutationDescriptor<string[]> = {
  method: 'POST',
  path: () => '/admin/assets/delete',
  body: (ids) => ({ ids }),
}

export function useDeleteAssets() {
  return useOfflineMutation<{ deletedIds: string[] }, string[]>({
    descriptor: deleteAssetsDescriptor,
    runOnline: (ids) => edenPost<{ deletedIds: string[] }>('/admin/assets/delete', { ids }),
    buildOfflineResult: (_queryClient, ids) => ({ deletedIds: ids }),
    onMutationSuccess: (queryClient) => {
      queryClient.invalidateQueries({ queryKey: assetsKeys.all })
    },
  })
}
