import { beforeEach, describe, expect, it, type mock, vi } from 'bun:test'
import '../../../test-utils/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { canQueueOfflineMutation } from '@/features/sync/offline-http-queue'
import { queueCommand } from '@/features/sync/queue-command'
import { triggerSync } from '@/features/sync/sync-scheduler'
import { ApiClientError } from '@/lib/api-error'
import { edenPost } from '@/lib/eden-client'
import type { CommandEnvelope } from './command-builder'

vi.mock('@/lib/eden-client', () => ({
  edenGet: vi.fn(),
  edenPost: vi.fn(),
  edenPut: vi.fn(),
  edenDelete: vi.fn(),
  edenPostForTenant: vi.fn(),
  edenPostMultipart: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/features/sync/queue-command', () => ({
  queueCommand: vi.fn(),
}))

vi.mock('@/features/sync/sync-scheduler', () => ({
  triggerSync: vi.fn(),
}))

vi.mock('@/features/sync/offline-http-queue', () => ({
  canQueueOfflineMutation: vi.fn(),
}))

const mockedEdenPost = edenPost as unknown as ReturnType<typeof mock>
const mockedQueueCommand = queueCommand as unknown as ReturnType<typeof mock>
const mockedTriggerSync = triggerSync as unknown as ReturnType<typeof mock>
const mockedCanQueueOfflineMutation = canQueueOfflineMutation as unknown as ReturnType<typeof mock>

// Dynamic import
const { useDryRunCommand, useExecuteCommand } = await import(
  `./use-execute-command?bypass=${Date.now()}`
)
type CommandStatus = Awaited<
  ReturnType<ReturnType<typeof useExecuteCommand>['mutateAsync']>
>['status']

const _failedStatus: CommandStatus = 'failed'
const _dryRunStatus: CommandStatus = 'dry_run'
void [_failedStatus, _dryRunStatus]

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const mockEnvelope: CommandEnvelope = {
  type: 'createEntry',
  payload: { collectionId: 'col-1', data: { title: 'Test' } },
  actor: { userId: 'current-user', source: 'admin' },
  timestamp: '2026-01-15T10:00:00.000Z',
}

describe('useExecuteCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedTriggerSync.mockResolvedValue(undefined)
    mockedCanQueueOfflineMutation.mockReturnValue(false)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
  })

  it('calls API with command envelope and returns result', async () => {
    const mockResult = {
      commandId: 'cmd-1',
      type: 'createEntry',
      status: 'failed',
      data: { id: 'entry-1' },
      executedAt: '2026-01-15T10:00:01.000Z',
    }
    mockedEdenPost.mockResolvedValueOnce(mockResult)

    const { result } = renderHook(() => useExecuteCommand(), {
      wrapper: createWrapper(),
    })

    await result.current.mutateAsync(mockEnvelope)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockedEdenPost).toHaveBeenCalledWith('/admin/commands', mockEnvelope)
    expect(result.current.data).toEqual(mockResult)
  })

  it('shows toast on version conflict (409)', async () => {
    const { toast } = await import('sonner')
    const error = new ApiClientError({ status: 409, message: 'Version conflict' })
    mockedEdenPost.mockRejectedValueOnce(error)

    const { result } = renderHook(() => useExecuteCommand(), {
      wrapper: createWrapper(),
    })

    await expect(result.current.mutateAsync(mockEnvelope)).rejects.toBe(error)
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(toast.error).toHaveBeenCalledWith(
      'This entry was modified by someone else. Please refresh and try again.'
    )
  })

  it('shows generic error toast for non-409 errors', async () => {
    const { toast } = await import('sonner')
    const error = new Error('Server error')
    mockedEdenPost.mockRejectedValueOnce(error)

    const { result } = renderHook(() => useExecuteCommand(), {
      wrapper: createWrapper(),
    })

    await expect(result.current.mutateAsync(mockEnvelope)).rejects.toBe(error)
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(toast.error).toHaveBeenCalledWith('Command failed: Server error')
  })

  it('queues command for offline sync on network failure', async () => {
    const { toast } = await import('sonner')
    mockedEdenPost.mockRejectedValueOnce(new TypeError('fetch failed'))
    mockedQueueCommand.mockResolvedValueOnce(undefined)
    mockedTriggerSync.mockResolvedValueOnce(undefined)
    mockedCanQueueOfflineMutation.mockReturnValue(true)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })

    const { result } = renderHook(() => useExecuteCommand(), {
      wrapper: createWrapper(),
    })

    const response = await result.current.mutateAsync(mockEnvelope)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockedQueueCommand).toHaveBeenCalledWith(mockEnvelope)
    expect(mockedTriggerSync).not.toHaveBeenCalled()
    expect(response.status).toBe('queued')
    expect(toast.success).toHaveBeenCalledWith('Command queued for offline sync')
  })
})

describe('useDryRunCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends command with dryRun flag and returns diff entries', async () => {
    const mockDiff = [{ field: 'title', before: 'Old', after: 'New', action: 'update' }]
    const mockResult = {
      commandId: 'cmd-1',
      type: 'updateEntry',
      status: 'dry_run',
      diff: mockDiff,
      executedAt: '2026-01-15T10:00:01.000Z',
    }
    mockedEdenPost.mockResolvedValueOnce(mockResult)

    const { result } = renderHook(() => useDryRunCommand(), {
      wrapper: createWrapper(),
    })

    await result.current.mutateAsync(mockEnvelope)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockedEdenPost).toHaveBeenCalledWith('/admin/commands', {
      ...mockEnvelope,
      dryRun: true,
    })
    expect(result.current.data).toEqual(mockDiff)
  })

  it('returns empty array when no diff in response', async () => {
    const mockResult = {
      commandId: 'cmd-1',
      type: 'updateEntry',
      status: 'success',
      executedAt: '2026-01-15T10:00:01.000Z',
    }
    mockedEdenPost.mockResolvedValueOnce(mockResult)

    const { result } = renderHook(() => useDryRunCommand(), {
      wrapper: createWrapper(),
    })

    await result.current.mutateAsync(mockEnvelope)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual([])
  })
})
