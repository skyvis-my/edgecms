import { useMutation, useQuery } from '@tanstack/react-query'
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
 * Query key factory for webhooks
 */
export const webhooksKeys = {
  all: ['webhooks'] as const,
  detail: (id: string) => ['webhooks', id] as const,
  deliveries: (webhookId: string) => ['webhooks', webhookId, 'deliveries'] as const,
}

/**
 * Type definitions matching the API schemas
 */
export type WebhookEventType =
  | 'entry.created'
  | 'entry.updated'
  | 'entry.deleted'
  | 'entry.published'
  | 'entry.unpublished'
  | 'entry.scheduled'
  | 'relation.linked'
  | 'relation.unlinked'
  | 'collection.created'
  | 'collection.updated'
  | 'collection.deleted'
  | 'entry.bulk_updated'

export type WebhookStatus = 'enabled' | 'disabled'

export type WebhookDefinition = {
  id: string
  url: string
  events: WebhookEventType[]
  customHeaders: Record<string, string>
  secret: string
  retryConfig: {
    maxRetries: number
    timeout: number
  }
  status: WebhookStatus
  lastDeliveryStatus?: 'delivered' | 'failed' | 'pending'
  lastDeliveryAt?: string
  createdAt: string
  updatedAt: string
}

export type CreateWebhookInput = {
  url: string
  events: WebhookEventType[]
  customHeaders?: Record<string, string>
  retryConfig?: {
    maxRetries: number
    timeout: number
  }
  status?: WebhookStatus
}

export type UpdateWebhookInput = Partial<CreateWebhookInput>

export type WebhookDelivery = {
  id: string
  webhookId: string
  eventType: WebhookEventType
  status: 'delivered' | 'failed' | 'pending'
  responseStatusCode?: number
  responseBody?: string
  retryCount: number
  createdAt: string
  deliveredAt?: string
}

export type TestWebhookResponse = {
  statusCode: number
  body: string
  success: boolean
}

function buildOptimisticWebhook(input: CreateWebhookInput): WebhookDefinition {
  const now = new Date().toISOString()
  return {
    id: `offline-${crypto.randomUUID()}`,
    url: input.url,
    events: input.events,
    customHeaders: input.customHeaders ?? {},
    secret: '',
    retryConfig: input.retryConfig ?? { maxRetries: 3, timeout: 5000 },
    status: input.status ?? 'enabled',
    createdAt: now,
    updatedAt: now,
  }
}

const createWebhookDescriptor: OfflineMutationDescriptor<CreateWebhookInput> = {
  method: 'POST',
  path: () => '/admin/webhooks',
  body: (input) => input,
}

const updateWebhookDescriptor: OfflineMutationDescriptor<{
  id: string
  input: UpdateWebhookInput
}> = {
  method: 'PUT',
  path: ({ id }) => `/admin/webhooks/${id}`,
  body: ({ input }) => input,
}

const deleteWebhookDescriptor: OfflineMutationDescriptor<string> = {
  method: 'DELETE',
  path: (id) => `/admin/webhooks/${id}`,
}

/**
 * Hook to fetch all webhooks
 */
export function useWebhooks() {
  return useQuery({
    queryKey: webhooksKeys.all,
    queryFn: async () => {
      return edenGet<WebhookDefinition[]>('/admin/webhooks')
    },
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook to fetch a single webhook by ID
 */
export function useWebhook(id: string) {
  return useQuery({
    queryKey: webhooksKeys.detail(id),
    queryFn: async () => {
      return edenGet<WebhookDefinition>(`/admin/webhooks/${id}`)
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook to create a new webhook
 */
export function useCreateWebhook() {
  return useOfflineMutation<
    WebhookDefinition,
    CreateWebhookInput,
    { previousWebhooks: WebhookDefinition[] }
  >({
    descriptor: createWebhookDescriptor,
    runOnline: (input) => edenPost<WebhookDefinition>('/admin/webhooks', input),
    buildOfflineResult: (_queryClient, input) => buildOptimisticWebhook(input),
    onMutateOptimistic: async (queryClient, input) => {
      const previousWebhooks = await snapshotListQuery<WebhookDefinition>(
        queryClient,
        webhooksKeys.all
      )
      appendListItem(queryClient, webhooksKeys.all, buildOptimisticWebhook(input))
      return { previousWebhooks }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.previousWebhooks) {
        restoreQuerySnapshot(queryClient, webhooksKeys.all, context.previousWebhooks)
      }
    },
    onMutationSuccess: (queryClient) => {
      queryClient.invalidateQueries({ queryKey: webhooksKeys.all })
    },
  })
}

/**
 * Hook to update an existing webhook
 */
export function useUpdateWebhook() {
  return useOfflineMutation<
    WebhookDefinition,
    { id: string; input: UpdateWebhookInput },
    { previousWebhooks: WebhookDefinition[]; previousDetail: WebhookDefinition | null; id: string }
  >({
    descriptor: updateWebhookDescriptor,
    runOnline: ({ id, input }) => edenPut<WebhookDefinition>(`/admin/webhooks/${id}`, input),
    buildOfflineResult: (queryClient, { id, input }) => {
      const cached = queryClient.getQueryData<WebhookDefinition>(webhooksKeys.detail(id))
      return {
        ...(cached ?? buildOptimisticWebhook({ url: '', events: [] })),
        ...input,
        id,
        updatedAt: new Date().toISOString(),
      } as WebhookDefinition
    },
    onMutateOptimistic: async (queryClient, { id, input }) => {
      const previousWebhooks = await snapshotListQuery<WebhookDefinition>(
        queryClient,
        webhooksKeys.all
      )
      const previousDetail = await snapshotDetailQuery<WebhookDefinition>(
        queryClient,
        webhooksKeys.detail(id)
      )

      mapListItems(queryClient, webhooksKeys.all, (webhook: WebhookDefinition) =>
        webhook.id === id ? { ...webhook, ...input, updatedAt: new Date().toISOString() } : webhook
      )
      patchDetail(queryClient, webhooksKeys.detail(id), (detail: WebhookDefinition) => ({
        ...detail,
        ...input,
        updatedAt: new Date().toISOString(),
      }))

      return { previousWebhooks, previousDetail, id }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.previousWebhooks) {
        restoreQuerySnapshot(queryClient, webhooksKeys.all, context.previousWebhooks)
      }
      if (context?.id && context.previousDetail) {
        restoreQuerySnapshot(queryClient, webhooksKeys.detail(context.id), context.previousDetail)
      }
    },
    onMutationSuccess: (queryClient, data) => {
      queryClient.invalidateQueries({ queryKey: webhooksKeys.all })
      queryClient.invalidateQueries({ queryKey: webhooksKeys.detail(data.id) })
    },
  })
}

/**
 * Hook to delete a webhook
 */
export function useDeleteWebhook() {
  return useOfflineMutation<void, string, { previousWebhooks: WebhookDefinition[] }>({
    descriptor: deleteWebhookDescriptor,
    runOnline: (id) => edenDelete(`/admin/webhooks/${id}`),
    buildOfflineResult: () => undefined,
    onMutateOptimistic: async (queryClient, id) => {
      const previousWebhooks = await snapshotListQuery<WebhookDefinition>(
        queryClient,
        webhooksKeys.all
      )
      filterListItems(
        queryClient,
        webhooksKeys.all,
        (webhook: WebhookDefinition) => webhook.id !== id
      )
      return { previousWebhooks }
    },
    onRollbackOptimistic: (queryClient, context) => {
      if (context?.previousWebhooks) {
        restoreQuerySnapshot(queryClient, webhooksKeys.all, context.previousWebhooks)
      }
    },
    onMutationSuccess: (queryClient) => {
      queryClient.invalidateQueries({ queryKey: webhooksKeys.all })
    },
  })
}

/**
 * Hook to test webhook delivery
 */
export function useTestWebhook() {
  return useMutation({
    mutationFn: async (id: string) => {
      return edenPost<TestWebhookResponse>(`/admin/webhooks/${id}/test`, {})
    },
  })
}

/**
 * Hook to fetch webhook delivery logs
 */
export function useWebhookDeliveries(webhookId: string) {
  return useQuery({
    queryKey: webhooksKeys.deliveries(webhookId),
    queryFn: async () => {
      return edenGet<WebhookDelivery[]>(`/admin/webhooks/${webhookId}/deliveries`)
    },
    enabled: !!webhookId,
    staleTime: 60 * 1000,
  })
}
