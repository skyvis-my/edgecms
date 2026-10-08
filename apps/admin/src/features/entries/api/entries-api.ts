import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  buildCancelScheduleCommand,
  buildCreateEntryCommand,
  buildDeleteEntryCommand,
  buildPublishNowCommand,
  buildSchedulePublishCommand,
  buildScheduleUnpublishCommand,
  buildUnpublishNowCommand,
  buildUpdateEntryCommand,
} from '@/features/commands/command-builder'
import { useExecuteCommand } from '@/features/commands/use-execute-command'
import { edenGet, edenPost } from '@/lib/eden-client'

/**
 * Query key factory for entries
 */
export const entriesKeys = {
  all: ['entries'] as const,
  lists: () => [...entriesKeys.all, 'list'] as const,
  list: (params: {
    collectionId?: string
    collectionSlug?: string
    status?: string
    page?: number
    perPage?: number
  }) =>
    [...entriesKeys.lists(), params] as const,
  details: () => [...entriesKeys.all, 'detail'] as const,
  detail: (id: string) => [...entriesKeys.details(), id] as const,
  byIdentifier: (identifier: string, collectionId?: string) =>
    [...entriesKeys.detail(identifier), 'by-identifier', collectionId] as const,
}

/**
 * Type definitions matching the API schemas
 */
export type EntryStatus = 'draft' | 'scheduled' | 'published' | 'archived'

export type Entry = {
  id: string
  collectionId: string
  slug: string
  status: EntryStatus
  data: Record<string, unknown>
  version: number
  serverDraftVersion?: number
  createdAt: string
  updatedAt: string
}

export type CreateEntryInput = {
  collectionId: string
  slug?: string
  status?: EntryStatus
  data: Record<string, unknown>
}

export type UpdateEntryInput = {
  slug?: string
  status?: EntryStatus
  data?: Record<string, unknown>
}

export type EntriesListParams = {
  collectionId?: string
  collectionSlug?: string
  status?: EntryStatus
  page?: number
  perPage?: number
  enabled?: boolean
}

export type PaginationMeta = {
  total: number
  page: number
  perPage: number
  hasMore: boolean
}

export type EntriesListResponse = {
  data: Entry[]
  meta: {
    pagination: PaginationMeta
  }
}

/**
 * Hook to fetch entries with optional filters
 */
export function useEntries(params: EntriesListParams = {}) {
  const { enabled = true, ...queryParamsInput } = params
  return useQuery({
    queryKey: entriesKeys.list(queryParamsInput),
    queryFn: async () => {
      const queryParams = new URLSearchParams()
      if (queryParamsInput.collectionId)
        queryParams.set('collectionId', queryParamsInput.collectionId)
      if (queryParamsInput.collectionSlug)
        queryParams.set('collectionSlug', queryParamsInput.collectionSlug)
      if (queryParamsInput.status) queryParams.set('status', queryParamsInput.status)
      if (queryParamsInput.page) queryParams.set('page', String(queryParamsInput.page))
      if (queryParamsInput.perPage) queryParams.set('perPage', String(queryParamsInput.perPage))

      return edenGet<EntriesListResponse>(`/admin/entries?${queryParams.toString()}`)
    },
    enabled,
    staleTime: 30_000,
  })
}

/**
 * Hook to fetch multiple entries by ID in a single batch request.
 * Eliminates N+1 queries when rendering lists of related entries.
 */
export function useEntriesByIds(ids: string[]) {
  const sortedIds = [...ids].sort()
  return useQuery({
    queryKey: [...entriesKeys.all, 'batch', sortedIds.join(',')],
    queryFn: async () => {
      if (sortedIds.length === 0) return []
      return edenGet<Entry[]>(
        `/admin/entries/batch?ids=${sortedIds.join(',')}`
      )
    },
    enabled: sortedIds.length > 0,
    staleTime: 30_000,
  })
}

/**
 * Hook to fetch a single entry by ID
 */
export function useEntry(id: string) {
  return useQuery({
    queryKey: entriesKeys.detail(id),
    queryFn: async () => {
      return edenGet<Entry>(`/admin/entries/${id}`)
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

/**
 * Hook to fetch a single entry by ID, with slug fallback within a collection
 */
export type EntryByIdentifierOptions = {
  collectionId?: string
  enabled?: boolean
  preferCollectionLookup?: boolean
}

export function useEntryByIdentifier(identifier: string, options: EntryByIdentifierOptions = {}) {
  const { collectionId, enabled = true, preferCollectionLookup = false } = options

  return useQuery({
    queryKey: entriesKeys.byIdentifier(identifier, collectionId),
    queryFn: async () => {
      const findByCollectionScope = async (): Promise<Entry | null> => {
        if (!collectionId) return null

        const queryParams = new URLSearchParams()
        queryParams.set('collectionId', collectionId)
        queryParams.set('page', '1')
        queryParams.set('perPage', '200')

        const response = await edenGet<EntriesListResponse>(`/admin/entries?${queryParams.toString()}`)
        return response.data.find((entry) => entry.slug === identifier || entry.id === identifier) ?? null
      }

      if (preferCollectionLookup) {
        const matched = await findByCollectionScope()
        if (matched) return matched
      }

      try {
        return await edenGet<Entry>(`/admin/entries/${identifier}`)
      } catch (error) {
        const matched = await findByCollectionScope()
        if (matched) return matched
        throw error
      }
    },
    enabled: enabled && !!identifier,
    staleTime: 30_000,
  })
}

/**
 * Hook to create a new entry via the command system
 */
export function useCreateEntry() {
  const queryClient = useQueryClient()
  const executeCommand = useExecuteCommand()

  return useMutation({
    mutationFn: async (input: CreateEntryInput) => {
      const command = buildCreateEntryCommand(
        input.collectionId,
        input.data,
        input.slug,
        input.status
      )

      const result = await executeCommand.mutateAsync(command)
      return result.data as Entry
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entriesKeys.lists() })
    },
  })
}

/**
 * Hook to update an existing entry via the command system
 */
export function useUpdateEntry() {
  const queryClient = useQueryClient()
  const executeCommand = useExecuteCommand()

  return useMutation({
    mutationFn: async ({
      id,
      input,
      optimisticVersion,
    }: {
      id: string
      input: UpdateEntryInput
      optimisticVersion?: number
    }) => {
      const command = buildUpdateEntryCommand(
        id,
        input.data,
        input.slug,
        input.status,
        optimisticVersion
      )

      const result = await executeCommand.mutateAsync(command)
      return result.data as Entry
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: entriesKeys.lists() })
      queryClient.invalidateQueries({ queryKey: entriesKeys.detail(variables.id) })
    },
  })
}

/**
 * Hook to delete an entry via the command system
 */
export function useDeleteEntry() {
  const queryClient = useQueryClient()
  const executeCommand = useExecuteCommand()

  return useMutation({
    mutationFn: async (id: string) => {
      const command = buildDeleteEntryCommand(id)
      await executeCommand.mutateAsync(command)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entriesKeys.lists() })
    },
  })
}

/**
 * Hook to duplicate an entry
 */
export function useDuplicateEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (entryId: string): Promise<Entry> => {
      return edenPost<Entry>(`/admin/entries/${entryId}/duplicate`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entriesKeys.lists() })
    },
  })
}

/**
 * Hook to publish an entry now via the command system
 */
export function usePublishEntry() {
  const queryClient = useQueryClient()
  const executeCommand = useExecuteCommand()

  return useMutation({
    mutationFn: async (id: string) => {
      const command = buildPublishNowCommand(id)
      const result = await executeCommand.mutateAsync(command)
      return result.data as Entry
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: entriesKeys.lists() })
      queryClient.invalidateQueries({ queryKey: entriesKeys.detail(id) })
    },
  })
}

/**
 * Hook to unpublish an entry now via the command system
 */
export function useUnpublishEntry() {
  const queryClient = useQueryClient()
  const executeCommand = useExecuteCommand()

  return useMutation({
    mutationFn: async (id: string) => {
      const command = buildUnpublishNowCommand(id)
      const result = await executeCommand.mutateAsync(command)
      return result.data as Entry
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: entriesKeys.lists() })
      queryClient.invalidateQueries({ queryKey: entriesKeys.detail(id) })
    },
  })
}

/**
 * Hook to schedule publishing for an entry
 */
export function useSchedulePublish() {
  const queryClient = useQueryClient()
  const executeCommand = useExecuteCommand()

  return useMutation({
    mutationFn: async ({ id, publishAt }: { id: string; publishAt: string }) => {
      const command = buildSchedulePublishCommand(id, publishAt)
      const result = await executeCommand.mutateAsync(command)
      return result.data as Entry
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: entriesKeys.lists() })
      queryClient.invalidateQueries({ queryKey: entriesKeys.detail(variables.id) })
    },
  })
}

/**
 * Hook to schedule unpublishing for an entry
 */
export function useScheduleUnpublish() {
  const queryClient = useQueryClient()
  const executeCommand = useExecuteCommand()

  return useMutation({
    mutationFn: async ({ id, unpublishAt }: { id: string; unpublishAt: string }) => {
      const command = buildScheduleUnpublishCommand(id, unpublishAt)
      const result = await executeCommand.mutateAsync(command)
      return result.data as Entry
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: entriesKeys.lists() })
      queryClient.invalidateQueries({ queryKey: entriesKeys.detail(variables.id) })
    },
  })
}

/**
 * Hook to cancel scheduled publish/unpublish
 */
export function useCancelSchedule() {
  const queryClient = useQueryClient()
  const executeCommand = useExecuteCommand()

  return useMutation({
    mutationFn: async (id: string) => {
      const command = buildCancelScheduleCommand(id)
      const result = await executeCommand.mutateAsync(command)
      return result.data as Entry
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: entriesKeys.lists() })
      queryClient.invalidateQueries({ queryKey: entriesKeys.detail(id) })
    },
  })
}
