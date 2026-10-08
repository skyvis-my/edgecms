import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCurrentTenantSlug } from '@/lib/tenant-storage'
import { db } from './local-db'
import { canQueueOfflineMutation, type OfflineHttpMethod } from './offline-http-queue'
import { useSyncStore } from './sync-store'

export type OfflineMutationDescriptor<TVariables> = {
  method: OfflineHttpMethod
  path: (variables: TVariables) => string
  body?: (variables: TVariables) => unknown
}

export function buildOfflineMutationRequest<TVariables>(
  descriptor: OfflineMutationDescriptor<TVariables>,
  variables: TVariables
): {
  method: OfflineHttpMethod
  path: string
  body?: unknown
} {
  return {
    method: descriptor.method,
    path: descriptor.path(variables),
    body: descriptor.body?.(variables),
  }
}

async function enqueueHttpMutationCommand(request: {
  method: string
  path: string
  body?: unknown
}): Promise<void> {
  await db.commandQueue.add({
    envelope: {
      type: 'httpMutation',
      payload: {
        method: request.method,
        path: request.path,
        body: request.body,
      },
      actor: { userId: 'local', source: 'admin' },
      timestamp: new Date().toISOString(),
    },
    tenantSlug: getCurrentTenantSlug(),
    status: 'pending',
    createdAt: new Date().toISOString(),
  })

  // Refresh pending count in the sync store
  const store = useSyncStore.getState()
  await store.refreshCounts()
}

type OfflineMutationConfig<TData, TVariables, TContext> = {
  descriptor: OfflineMutationDescriptor<TVariables>
  runOnline: (variables: TVariables) => Promise<TData>
  buildOfflineResult: (queryClient: QueryClient, variables: TVariables) => TData
  onMutateOptimistic?: (
    queryClient: QueryClient,
    variables: TVariables
  ) => Promise<TContext> | TContext
  onRollbackOptimistic?: (
    queryClient: QueryClient,
    context: TContext | undefined,
    variables: TVariables
  ) => Promise<void> | void
  onMutationSuccess?: (
    queryClient: QueryClient,
    data: TData,
    variables: TVariables
  ) => Promise<void> | void
  onMutationError?: (error: Error, variables: TVariables) => Promise<void> | void
}

export function useOfflineMutation<TData, TVariables, TContext = unknown>(
  config: OfflineMutationConfig<TData, TVariables, TContext>
) {
  const queryClient = useQueryClient()

  return useMutation<TData, Error, TVariables, TContext | undefined>({
    mutationFn: async (variables) => {
      const request = buildOfflineMutationRequest(config.descriptor, variables)

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await enqueueHttpMutationCommand(request)
        return config.buildOfflineResult(queryClient, variables)
      }

      try {
        return await config.runOnline(variables)
      } catch (error) {
        if (!canQueueOfflineMutation(error)) {
          throw error
        }
        await enqueueHttpMutationCommand(request)
        return config.buildOfflineResult(queryClient, variables)
      }
    },
    onMutate: (variables) => config.onMutateOptimistic?.(queryClient, variables),
    onError: async (error, variables, context) => {
      await config.onRollbackOptimistic?.(queryClient, context, variables)
      await config.onMutationError?.(error, variables)
    },
    onSuccess: (data, variables) => config.onMutationSuccess?.(queryClient, data, variables),
  })
}
