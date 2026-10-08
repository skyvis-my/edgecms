import { useQuery } from '@tanstack/react-query'
import { type OfflineMutationDescriptor, useOfflineMutation } from '@/features/sync/use-offline-mutation'
import { edenGet, edenPost } from '@/lib/eden-client'

/**
 * Query key factory for versions
 */
export const versionsKeys = {
  all: ['versions'] as const,
  lists: () => [...versionsKeys.all, 'list'] as const,
  list: (entryId: string, page?: number) => [...versionsKeys.lists(), entryId, page] as const,
  details: () => [...versionsKeys.all, 'detail'] as const,
  detail: (entryId: string, versionId: string) =>
    [...versionsKeys.details(), entryId, versionId] as const,
  diff: (entryId: string, v1: string, v2: string) => ['diff', entryId, v1, v2] as const,
}

/** @deprecated Use versionsKeys */
export const versionKeys = versionsKeys

/**
 * Type definitions for version history
 */
export type EntryVersion = {
  id: string
  entryId: string
  version: number
  data: Record<string, unknown>
  slug: string
  status: string
  createdAt: string
  createdBy: string | null
  changeSummary?: string
}

export type VersionDiff = {
  field: string
  before: unknown
  after: unknown
  action: 'add' | 'update' | 'remove'
}

export type VersionsListResponse = {
  data: EntryVersion[]
  meta: {
    pagination: {
      total: number
      page: number
      perPage: number
      hasMore: boolean
    }
  }
}

const rollbackDescriptor: OfflineMutationDescriptor<{ entryId: string; versionId: string }> = {
  method: 'POST',
  path: ({ entryId, versionId }) => `/admin/entries/${entryId}/versions/${versionId}/rollback`,
}

/**
 * Hook to fetch version history for an entry
 */
export function useVersions(entryId: string, page = 1) {
  return useQuery({
    queryKey: versionsKeys.list(entryId, page),
    queryFn: async () => {
      return edenGet<VersionsListResponse>(`/admin/entries/${entryId}/versions?page=${page}`)
    },
    enabled: !!entryId,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook to fetch a single version
 */
export function useVersion(entryId: string, versionId: string) {
  return useQuery({
    queryKey: versionsKeys.detail(entryId, versionId),
    queryFn: async () => {
      return edenGet<EntryVersion>(`/admin/entries/${entryId}/versions/${versionId}`)
    },
    enabled: !!entryId && !!versionId,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook to fetch diff between two versions
 */
export function useVersionDiff(entryId: string, v1: string, v2: string) {
  return useQuery({
    queryKey: versionsKeys.diff(entryId, v1, v2),
    queryFn: async () => {
      const response = await edenGet<{ diffs: VersionDiff[] }>(
        `/admin/entries/${entryId}/versions/${v1}/diff/${v2}`
      )
      return response.diffs
    },
    enabled: !!entryId && !!v1 && !!v2,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook to rollback to a specific version
 */
export function useRollback() {
  return useOfflineMutation<EntryVersion, { entryId: string; versionId: string }>({
    descriptor: rollbackDescriptor,
    runOnline: ({ entryId, versionId }) =>
      edenPost<EntryVersion>(`/admin/entries/${entryId}/versions/${versionId}/rollback`),
    buildOfflineResult: (queryClient, { entryId, versionId }) => {
      const cachedVersions =
        queryClient.getQueryData<VersionsListResponse>(versionsKeys.list(entryId, 1))?.data ?? []
      const fallback = cachedVersions.find((version) => version.id === versionId)
      if (fallback) {
        return fallback
      }

      return {
        id: versionId,
        entryId,
        version: 0,
        data: {},
        slug: '',
        status: 'draft',
        createdAt: new Date().toISOString(),
        createdBy: null,
      } satisfies EntryVersion
    },
    onMutationSuccess: (queryClient, data) => {
      queryClient.invalidateQueries({ queryKey: versionsKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ['entries', 'detail', data.entryId] })
    },
  })
}
