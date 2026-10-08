import { useQuery } from '@tanstack/react-query'
import {
  appendListItem,
  filterListItems,
  mapListItems,
  patchDetail,
  restoreQuerySnapshot,
  snapshotDetailQuery,
  snapshotListQuery,
} from '@/features/sync/query-cache-optimistic'
import { type OfflineMutationDescriptor, useOfflineMutation } from '@/features/sync/use-offline-mutation'
import { edenDelete, edenGet, edenPost, edenPut } from '@/lib/eden-client'

/**
 * Query key factory for collections
 */
export const collectionsKeys = {
  all: ['collections'] as const,
  detail: (id: string) => ['collections', id] as const,
}

/**
 * Type definitions matching the API schemas
 */
export type FieldType =
  | 'text'
  | 'richtext'
  | 'markdown'
  | 'number'
  | 'boolean'
  | 'date'
  | 'media'
  | 'relation'
  | 'json'
  | 'array'
  | 'select'
  | 'email'
  | 'url'
  | 'slug'
  | 'color'

export const FIELD_TYPES = [
  'text',
  'richtext',
  'markdown',
  'number',
  'boolean',
  'date',
  'media',
  'relation',
  'json',
  'array',
  'select',
  'email',
  'url',
  'slug',
  'color',
] as const satisfies readonly FieldType[]

export type FieldComponentType = 'input' | 'textarea'
export type RelationType = 'one-to-one' | 'one-to-many' | 'many-to-many'

export type FieldOptions = {
  component?: FieldComponentType
  relationType?: RelationType
  targetCollectionId?: string
  [key: string]: unknown
}

export type FieldDefinition = {
  name: string
  type: FieldType
  required: boolean
  localizable: boolean
  options?: FieldOptions
}

export type CollectionDefinition = {
  id: string
  name: string
  slug: string
  singleton: boolean
  fields: FieldDefinition[]
  defaultLocale: string
  supportedLocales: string[]
  createdAt: string
  updatedAt: string
}

export type CreateCollectionInput = {
  name: string
  slug?: string
  singleton?: boolean
  fields: FieldDefinition[]
  defaultLocale?: string
  supportedLocales?: string[]
}

export type UpdateCollectionInput = {
  name?: string
  singleton?: boolean
  fields?: FieldDefinition[]
  defaultLocale?: string
  supportedLocales?: string[]
}

function buildOptimisticCollection(input: CreateCollectionInput): CollectionDefinition {
  const now = new Date().toISOString()

  return {
    id: `offline-${crypto.randomUUID()}`,
    name: input.name,
    slug: input.name.trim().toLowerCase().replace(/\s+/g, '-'),
    singleton: input.singleton ?? false,
    fields: input.fields,
    defaultLocale: input.defaultLocale ?? 'en',
    supportedLocales: input.supportedLocales ?? [input.defaultLocale ?? 'en'],
    createdAt: now,
    updatedAt: now,
  }
}

const createCollectionMutationDescriptor: OfflineMutationDescriptor<CreateCollectionInput> = {
  method: 'POST',
  path: () => '/admin/collections',
  body: (input) => input,
}

const updateCollectionMutationDescriptor: OfflineMutationDescriptor<{
  id: string
  input: UpdateCollectionInput
}> = {
  method: 'PUT',
  path: ({ id }) => `/admin/collections/${id}`,
  body: ({ input }) => input,
}

const deleteCollectionMutationDescriptor: OfflineMutationDescriptor<string> = {
  method: 'DELETE',
  path: (id) => `/admin/collections/${id}`,
}

/**
 * Hook to fetch all collections
 */
export function useCollections() {
  return useQuery({
    queryKey: collectionsKeys.all,
    queryFn: async () => edenGet<CollectionDefinition[]>('/admin/collections'),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook to fetch a single collection by ID
 */
export function useCollection(id: string) {
  return useQuery({
    queryKey: collectionsKeys.detail(id),
    queryFn: async () => edenGet<CollectionDefinition>(`/admin/collections/${id}`),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook to fetch a collection by identifier (ID or slug)
 */
export function useCollectionByIdentifier(identifier: string) {
  return useQuery({
    queryKey: [...collectionsKeys.detail(identifier), 'by-identifier'],
    queryFn: async () => {
      try {
        return await edenGet<CollectionDefinition>(`/admin/collections/${identifier}`)
      } catch (error) {
        const collections = await edenGet<CollectionDefinition[]>('/admin/collections')
        const matched = collections.find((collection) => collection.slug === identifier)
        if (matched) return matched
        throw error
      }
    },
    enabled: !!identifier,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook to create a new collection
 */
export function useCreateCollection() {
  return useOfflineMutation<
    CollectionDefinition,
    CreateCollectionInput,
    { previousCollections: CollectionDefinition[] }
  >({
    descriptor: createCollectionMutationDescriptor,
    runOnline: (input) => edenPost<CollectionDefinition>('/admin/collections', input),
    buildOfflineResult: (_queryClient, input) => buildOptimisticCollection(input),
    onMutateOptimistic: async (queryClient, input) => {
      const previousCollections = await snapshotListQuery<CollectionDefinition>(
        queryClient,
        collectionsKeys.all
      )
      const optimistic = buildOptimisticCollection(input)
      appendListItem(queryClient, collectionsKeys.all, optimistic)
      return { previousCollections }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.previousCollections) {
        restoreQuerySnapshot(queryClient, collectionsKeys.all, context.previousCollections)
      }
    },
    onMutationSuccess: (queryClient) => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.all })
    },
  })
}

/**
 * Hook to update an existing collection
 */
export function useUpdateCollection() {
  return useOfflineMutation<
    CollectionDefinition,
    { id: string; input: UpdateCollectionInput },
    {
      previousCollections: CollectionDefinition[]
      previousDetail: CollectionDefinition | null
      id: string
    }
  >({
    descriptor: updateCollectionMutationDescriptor,
    runOnline: ({ id, input }) => edenPut<CollectionDefinition>(`/admin/collections/${id}`, input),
    buildOfflineResult: (queryClient, { id, input }) => {
      const cached = queryClient.getQueryData<CollectionDefinition>(collectionsKeys.detail(id))
      return {
        ...(cached ?? buildOptimisticCollection({ name: id, fields: [] })),
        ...input,
        id,
        updatedAt: new Date().toISOString(),
      } as CollectionDefinition
    },
    onMutateOptimistic: async (queryClient, { id, input }) => {
      const previousCollections = await snapshotListQuery<CollectionDefinition>(
        queryClient,
        collectionsKeys.all
      )
      const previousDetail = await snapshotDetailQuery<CollectionDefinition>(
        queryClient,
        collectionsKeys.detail(id)
      )

      mapListItems(queryClient, collectionsKeys.all, (collection: CollectionDefinition) =>
        collection.id === id
          ? { ...collection, ...input, updatedAt: new Date().toISOString() }
          : collection
      )
      patchDetail(queryClient, collectionsKeys.detail(id), (detail: CollectionDefinition) => ({
        ...detail,
        ...input,
        updatedAt: new Date().toISOString(),
      }))

      return { previousCollections, previousDetail, id }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.previousCollections) {
        restoreQuerySnapshot(queryClient, collectionsKeys.all, context.previousCollections)
      }
      if (context?.id && context.previousDetail) {
        restoreQuerySnapshot(
          queryClient,
          collectionsKeys.detail(context.id),
          context.previousDetail
        )
      }
    },
    onMutationSuccess: (queryClient, data) => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.all })
      queryClient.invalidateQueries({ queryKey: collectionsKeys.detail(data.id) })
    },
  })
}

/**
 * Hook to delete a collection
 */
export function useDeleteCollection() {
  return useOfflineMutation<void, string, { previousCollections: CollectionDefinition[] }>({
    descriptor: deleteCollectionMutationDescriptor,
    runOnline: (id) => edenDelete(`/admin/collections/${id}`),
    buildOfflineResult: () => undefined,
    onMutateOptimistic: async (queryClient, id) => {
      const previousCollections = await snapshotListQuery<CollectionDefinition>(
        queryClient,
        collectionsKeys.all
      )
      filterListItems(
        queryClient,
        collectionsKeys.all,
        (collection: CollectionDefinition) => collection.id !== id
      )
      return { previousCollections }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.previousCollections) {
        restoreQuerySnapshot(queryClient, collectionsKeys.all, context.previousCollections)
      }
    },
    onMutationSuccess: (queryClient) => {
      queryClient.invalidateQueries({ queryKey: collectionsKeys.all })
    },
  })
}
