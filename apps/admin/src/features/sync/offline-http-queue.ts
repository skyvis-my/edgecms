import { ApiClientError } from '@/lib/api-error'
import { db } from './local-db'

export type OfflineHttpMethod = 'POST' | 'PUT' | 'DELETE'

export interface HttpMutationPayload {
  method: string
  path: string
  body?: unknown
}

export type ReplayErrorClassification = 'retryable' | 'conflict'

export function canQueueOfflineMutation(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true
  }

  if (error instanceof ApiClientError) {
    return (error.status ?? 0) >= 500
  }
  return error instanceof TypeError
}

export function isValidHttpMutationMethod(method: unknown): method is OfflineHttpMethod {
  return method === 'POST' || method === 'PUT' || method === 'DELETE'
}

export function validateHttpMutationPayload(payload: unknown): payload is HttpMutationPayload {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as Record<string, unknown>
  return (
    typeof p.method === 'string' &&
    isValidHttpMutationMethod(p.method) &&
    typeof p.path === 'string' &&
    p.path.length > 0
  )
}

export function isRetryableReplayError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (error instanceof ApiClientError) {
    return (error.status ?? 0) >= 500
  }
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status
    if (typeof status === 'number') {
      return status >= 500
    }
  }
  return false
}

export function classifyReplayError(error: unknown): ReplayErrorClassification {
  if (isRetryableReplayError(error)) {
    return 'retryable'
  }
  return 'conflict'
}

export async function handleReplayConflict(
  commandId: number,
  error: unknown,
  serverState?: Record<string, unknown>
): Promise<void> {
  const errorMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Mutation replay failed'

  await db.commandQueue.update(commandId, {
    status: 'conflicted',
    error: errorMessage,
    serverState,
  })
}

export async function handleReplaySuccess(commandId: number): Promise<void> {
  await db.commandQueue.update(commandId, {
    status: 'synced',
    syncedAt: new Date().toISOString(),
    error: undefined,
  })
}

export async function handleReplayRetry(commandId: number): Promise<void> {
  await db.commandQueue.update(commandId, {
    status: 'pending',
  })
}

export async function resolveReplayConflict(
  commandId: number,
  resolution:
    | { action: 'retry' }
    | { action: 'discard' }
    | { action: 'override'; payload: HttpMutationPayload }
): Promise<void> {
  if (resolution.action === 'discard') {
    await db.commandQueue.delete(commandId)
    return
  }

  if (resolution.action === 'retry') {
    await db.commandQueue.update(commandId, {
      status: 'pending',
      error: undefined,
      serverState: undefined,
    })
    return
  }

  if (resolution.action === 'override') {
    const item = await db.commandQueue.get(commandId)
    if (!item) {
      throw new Error(`Command queue item ${commandId} not found`)
    }
    const envelope = { ...(item.envelope as Record<string, unknown>) }
    envelope.payload = resolution.payload

    await db.commandQueue.update(commandId, {
      envelope,
      status: 'pending',
      error: undefined,
      serverState: undefined,
    })
  }
}
