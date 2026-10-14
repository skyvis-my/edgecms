import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { ApiClientError } from '@/lib/api-error'
import {
  canQueueOfflineMutation,
  classifyReplayError,
  handleReplayConflict,
  handleReplayRetry,
  handleReplaySuccess,
  isRetryableReplayError,
  isValidHttpMutationMethod,
  resolveReplayConflict,
  validateHttpMutationPayload,
} from './offline-http-queue'

const mockUpdate = vi.fn().mockResolvedValue(1)
const mockDelete = vi.fn().mockResolvedValue(undefined)
const mockGet = vi.fn()

vi.mock('./local-db', () => ({
  db: {
    commandQueue: {
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
      get: (...args: unknown[]) => mockGet(...args),
    },
    syncState: {
      get: vi.fn().mockResolvedValue({ id: 'global' }),
      put: vi.fn().mockResolvedValue(undefined),
    },
  },
}))

describe('offline-http-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('canQueueOfflineMutation', () => {
    it('returns true when navigator is offline', () => {
      const originalNavigator = globalThis.navigator
      try {
        Object.defineProperty(globalThis, 'navigator', {
          value: { onLine: false },
          configurable: true,
        })
        expect(canQueueOfflineMutation(new Error('any error'))).toBe(true)
      } finally {
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNavigator,
          configurable: true,
        })
      }
    })

    it('returns true for 5xx ApiClientError', () => {
      const error500 = new ApiClientError({ message: 'Internal error', status: 500 })
      const error503 = new ApiClientError({ message: 'Service unavailable', status: 503 })
      expect(canQueueOfflineMutation(error500)).toBe(true)
      expect(canQueueOfflineMutation(error503)).toBe(true)
    })

    it('returns false for 4xx ApiClientError', () => {
      const error400 = new ApiClientError({ message: 'Bad Request', status: 400 })
      const error404 = new ApiClientError({ message: 'Not Found', status: 404 })
      const error409 = new ApiClientError({ message: 'Conflict', status: 409 })
      expect(canQueueOfflineMutation(error400)).toBe(false)
      expect(canQueueOfflineMutation(error404)).toBe(false)
      expect(canQueueOfflineMutation(error409)).toBe(false)
    })

    it('returns true for network TypeError', () => {
      const networkError = new TypeError('Failed to fetch')
      expect(canQueueOfflineMutation(networkError)).toBe(true)
    })

    it('returns false for generic Error when online', () => {
      expect(canQueueOfflineMutation(new Error('generic failure'))).toBe(false)
      expect(canQueueOfflineMutation('string error')).toBe(false)
      expect(canQueueOfflineMutation(null)).toBe(false)
    })
  })

  describe('validateHttpMutationPayload', () => {
    it('validates supported HTTP mutation methods', () => {
      expect(isValidHttpMutationMethod('POST')).toBe(true)
      expect(isValidHttpMutationMethod('PUT')).toBe(true)
      expect(isValidHttpMutationMethod('DELETE')).toBe(true)
      expect(isValidHttpMutationMethod('GET')).toBe(false)
      expect(isValidHttpMutationMethod('PATCH')).toBe(false)
    })

    it('returns true for valid mutation payload', () => {
      expect(
        validateHttpMutationPayload({
          method: 'POST',
          path: '/api/entries',
          body: { title: 'Test' },
        })
      ).toBe(true)
      expect(
        validateHttpMutationPayload({
          method: 'DELETE',
          path: '/api/entries/123',
        })
      ).toBe(true)
    })

    it('returns false for invalid payload structures', () => {
      expect(validateHttpMutationPayload(null)).toBe(false)
      expect(validateHttpMutationPayload('not an object')).toBe(false)
      expect(validateHttpMutationPayload({ method: 'GET', path: '/api/entries' })).toBe(false)
      expect(validateHttpMutationPayload({ method: 'POST', path: '' })).toBe(false)
      expect(validateHttpMutationPayload({ method: 'POST' })).toBe(false)
    })
  })

  describe('isRetryableReplayError & classifyReplayError', () => {
    it('classifies TypeError as retryable', () => {
      const err = new TypeError('Network connection lost')
      expect(isRetryableReplayError(err)).toBe(true)
      expect(classifyReplayError(err)).toBe('retryable')
    })

    it('classifies 5xx errors as retryable', () => {
      const err = new ApiClientError({ message: 'Server error', status: 502 })
      expect(isRetryableReplayError(err)).toBe(true)
      expect(classifyReplayError(err)).toBe('retryable')

      const customStatus = { status: 504, message: 'Gateway timeout' }
      expect(isRetryableReplayError(customStatus)).toBe(true)
      expect(classifyReplayError(customStatus)).toBe('retryable')
    })

    it('classifies 4xx errors as conflict', () => {
      const err = new ApiClientError({ message: 'Conflict detected', status: 409 })
      expect(isRetryableReplayError(err)).toBe(false)
      expect(classifyReplayError(err)).toBe('conflict')

      const err400 = { status: 400, message: 'Bad payload' }
      expect(isRetryableReplayError(err400)).toBe(false)
      expect(classifyReplayError(err400)).toBe('conflict')

      const nonNumericStatus = { status: 'internal_error' }
      expect(isRetryableReplayError(nonNumericStatus)).toBe(false)
      expect(classifyReplayError(nonNumericStatus)).toBe('conflict')

      expect(isRetryableReplayError('raw string error')).toBe(false)
      expect(classifyReplayError(null)).toBe('conflict')
    })
  })

  describe('Dexie replay conflict and resolution lifecycle', () => {
    it('handleReplayConflict marks item as conflicted with error and serverState', async () => {
      await handleReplayConflict(42, new Error('Version mismatch'), { version: 3 })

      expect(mockUpdate).toHaveBeenCalledWith(42, {
        status: 'conflicted',
        error: 'Version mismatch',
        serverState: { version: 3 },
      })
    })

    it('handleReplayConflict handles string error', async () => {
      await handleReplayConflict(42, 'Direct error message')

      expect(mockUpdate).toHaveBeenCalledWith(42, {
        status: 'conflicted',
        error: 'Direct error message',
        serverState: undefined,
      })
    })

    it('handleReplaySuccess marks item as synced', async () => {
      await handleReplaySuccess(42)

      expect(mockUpdate).toHaveBeenCalledWith(42, {
        status: 'synced',
        syncedAt: expect.any(String),
        error: undefined,
      })
    })

    it('handleReplayRetry resets status to pending', async () => {
      await handleReplayRetry(42)

      expect(mockUpdate).toHaveBeenCalledWith(42, {
        status: 'pending',
      })
    })

    it('resolveReplayConflict with discard removes item from Dexie queue', async () => {
      await resolveReplayConflict(42, { action: 'discard' })

      expect(mockDelete).toHaveBeenCalledWith(42)
    })

    it('resolveReplayConflict with retry clears error and resets to pending', async () => {
      await resolveReplayConflict(42, { action: 'retry' })

      expect(mockUpdate).toHaveBeenCalledWith(42, {
        status: 'pending',
        error: undefined,
        serverState: undefined,
      })
    })

    it('resolveReplayConflict with override updates payload and resets to pending', async () => {
      mockGet.mockResolvedValueOnce({
        id: 42,
        envelope: {
          type: 'httpMutation',
          payload: { method: 'POST', path: '/api/posts', body: { title: 'Old' } },
        },
        status: 'conflicted',
      })

      const newPayload = { method: 'POST', path: '/api/posts', body: { title: 'New' } }
      await resolveReplayConflict(42, { action: 'override', payload: newPayload })

      expect(mockGet).toHaveBeenCalledWith(42)
      expect(mockUpdate).toHaveBeenCalledWith(42, {
        envelope: {
          type: 'httpMutation',
          payload: newPayload,
        },
        status: 'pending',
        error: undefined,
        serverState: undefined,
      })
    })

    it('resolveReplayConflict with override throws if item not found', async () => {
      mockGet.mockResolvedValueOnce(undefined)

      await expect(
        resolveReplayConflict(999, {
          action: 'override',
          payload: { method: 'POST', path: '/api/posts' },
        })
      ).rejects.toThrow(/not found/i)
    })
  })
})
