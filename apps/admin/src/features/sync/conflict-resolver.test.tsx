import { beforeEach, describe, expect, it, vi } from 'bun:test'
import '../../../test-utils/setup'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { ConflictResolver } from './components/conflict-resolver'
import * as queueModule from './queue-command'
import * as schedulerModule from './sync-scheduler'
import * as storeModule from './sync-store'

describe('ConflictResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(queueModule, 'queueCommand').mockResolvedValue(undefined)
    vi.spyOn(schedulerModule, 'triggerSync').mockResolvedValue(undefined)
    vi.spyOn(storeModule, 'useSyncStore').mockReturnValue({
      status: 'idle',
      lastSyncAt: null,
      conflictCount: 0,
      pendingCount: 0,
      error: null,
      setStatus: vi.fn(),
      setLastSyncAt: vi.fn(),
      setConflictCount: vi.fn(),
      setPendingCount: vi.fn(),
      setError: vi.fn(),
      refreshCounts: vi.fn().mockResolvedValue(undefined),
    })
    vi.spyOn(toast, 'success').mockImplementation(() => '')
    vi.spyOn(toast, 'error').mockImplementation(() => '')
  })

  it('merges from serverState.entry.data when keeping all server fields', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ConflictResolver
        open
        onClose={onClose}
        conflict={{
          status: 'conflicted',
          createdAt: new Date().toISOString(),
          envelope: {
            type: 'updateEntry',
            payload: { data: { title: 'Local title', body: 'Local body' } },
          },
          serverState: {
            entry: { data: { title: 'Server title', body: 'Server body' } },
          },
        }}
      />
    )

    expect(screen.getAllByText('Server title').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Keep All Server' }))
    await user.click(screen.getByRole('button', { name: 'Apply Merge' }))

    await waitFor(() => {
      expect(queueModule.queueCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            data: { title: 'Server title', body: 'Server body' },
          }),
        })
      )
    })

    expect(schedulerModule.triggerSync).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
