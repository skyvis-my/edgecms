import { ApiClientError } from '@/lib/api-error'

export type OfflineHttpMethod = 'POST' | 'PUT' | 'DELETE'

export function canQueueOfflineMutation(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true
  }

  if (error instanceof ApiClientError) {
    return (error.status ?? 0) >= 500
  }
  return error instanceof TypeError
}
