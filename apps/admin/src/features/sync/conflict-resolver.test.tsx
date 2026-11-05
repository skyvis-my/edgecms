import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import '../../../test-utils/setup'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { ConflictResolver } from './components/conflict-resolver'
import { type CommandQueueItem, db } from './local-db'
import * as schedulerModule from './sync-scheduler'
import * as storeModule from './sync-store'

const collection = {
  id: 'c1',
  name: 'Posts',
  slug: 'posts',
  singleton: false,
  fields: [
    { name: 'title', type: 'text', required: true, localizable: true },
    { name: 'body', type: 'text', required: false, localizable: false },
    { name: 'summary', type: 'text', required: false, localizable: false },
  ],
  defaultLocale: 'en',
  supportedLocales: ['en', 'ms'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** Base v3; mine changed title.en, body and summary; theirs (v5) changed title.en, title.ms and body. */
function makeConflict(overrides: Partial<CommandQueueItem> = {}): CommandQueueItem {
  return {
    status: 'conflicted',
    tenantSlug: 'acme',
    createdAt: '2026-11-05T00:00:00.000Z',
    envelope: {
      type: 'updateEntry',
      payload: {
        entryId: 'e1',
        slug: 'hello',
        data: {
          title: { en: 'Hello (mine)', ms: 'Halo' },
          body: 'Body (mine)',
          summary: 'Summary (mine)',
        },
      },
      optimisticVersion: 3,
      actor: { userId: 'u1', source: 'admin' },
      timestamp: '2026-11-05T00:00:00.000Z',
    },
    base: {
      version: 3,
      slug: 'hello',
      data: { title: { en: 'Hello', ms: 'Halo' }, body: 'Body', summary: 'Summary' },
    },
    serverState: {
      entry: {
        id: 'e1',
        collectionId: 'c1',
        slug: 'hello',
        status: 'draft',
        version: 5,
        data: {
          title: { en: 'Hello (theirs)', ms: 'Halo (theirs)' },
          body: 'Body (theirs)',
          summary: 'Summary',
        },
      },
      version: 5,
      conflictingFields: ['title', 'body', 'summary'],
    },
    error: 'Expected version 3 but found 5',
    ...overrides,
  }
}

async function seed(item: CommandQueueItem): Promise<CommandQueueItem> {
  const id = await db.commandQueue.add(item)
  return { ...item, id }
}

describe('ConflictResolver (OF-04)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await db.commandQueue.clear()
    await db.collections.clear()
    await db.collections.put(collection)
    vi.spyOn(schedulerModule, 'triggerSync').mockResolvedValue(undefined)
    vi.spyOn(storeModule, 'useSyncStore').mockReturnValue({
      status: 'idle',
      lastSyncAt: null,
      conflictCount: 1,
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

  afterEach(async () => {
    await db.commandQueue.clear()
  })

  it('lists only truly conflicting fields and locales', async () => {
    const conflict = await seed(makeConflict())
    render(<ConflictResolver open onClose={vi.fn()} conflict={conflict} />)

    await waitFor(() => expect(screen.getAllByTestId('conflict-field')).toHaveLength(2))
    const keys = screen.getAllByTestId('conflict-field').map((el) => el.dataset.conflictKey)
    // title.ms (theirs only) and summary (mine only) merge automatically.
    expect(keys).toEqual(['body', 'title@en'])
    expect(screen.getByText(/2 other changes were merged automatically/)).toBeTruthy()
    expect(screen.getByTestId('entry-status-indicator').dataset.sync).toBe('conflicted')
  })

  it('takes theirs by default and re-queues the merge against the server version', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const conflict = await seed(makeConflict())
    render(<ConflictResolver open onClose={onClose} conflict={conflict} />)

    await waitFor(() => expect(screen.getAllByTestId('conflict-field')).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Save merge' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const row = await db.commandQueue.get(conflict.id as number)
    expect(row?.status).toBe('pending')
    expect(row?.envelope.optimisticVersion).toBe(5)
    expect((row?.envelope.payload as Record<string, unknown> | undefined)?.data).toEqual({
      title: { en: 'Hello (theirs)', ms: 'Halo (theirs)' },
      body: 'Body (theirs)',
      summary: 'Summary (mine)',
    })
    expect(row?.base?.version).toBe(5)
    expect(row?.serverState).toBeUndefined()
    expect(schedulerModule.triggerSync).toHaveBeenCalledTimes(1)
  })

  it('requires explicit confirmation before keeping mine over a newer server value', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const conflict = await seed(makeConflict())
    render(<ConflictResolver open onClose={onClose} conflict={conflict} />)

    await waitFor(() => expect(screen.getAllByTestId('conflict-field')).toHaveLength(2))
    const titleCard = screen
      .getAllByTestId('conflict-field')
      .find((el) => el.dataset.conflictKey === 'title@en') as HTMLElement
    await user.click(within(titleCard).getByRole('radio', { name: /Keep mine/ }))

    await user.click(screen.getByRole('button', { name: /Save, overwriting 1 server value/ }))

    // Nothing is written until the overwrite is confirmed.
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Overwrite server version 5\?/)).toBeTruthy()
    expect(within(dialog).getByText(/title \(EN\)/)).toBeTruthy()
    expect((await db.commandQueue.get(conflict.id as number))?.status).toBe('conflicted')

    await user.click(within(dialog).getByRole('button', { name: 'Overwrite and sync' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const row = await db.commandQueue.get(conflict.id as number)
    expect(row?.status).toBe('pending')
    expect((row?.envelope.payload as Record<string, unknown> | undefined)?.data).toEqual({
      title: { en: 'Hello (mine)', ms: 'Halo (theirs)' },
      body: 'Body (theirs)',
      summary: 'Summary (mine)',
    })
  })

  it('cancelling the overwrite confirmation leaves the conflict queued', async () => {
    const user = userEvent.setup()
    const conflict = await seed(makeConflict())
    render(<ConflictResolver open onClose={vi.fn()} conflict={conflict} />)

    await waitFor(() => expect(screen.getAllByTestId('conflict-field')).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Keep all mine' }))
    await user.click(screen.getByRole('button', { name: /Save, overwriting 2 server values/ }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((await db.commandQueue.get(conflict.id as number))?.status).toBe('conflicted')
    expect(schedulerModule.triggerSync).not.toHaveBeenCalled()
  })

  it('drops the queued change when the result equals the server state', async () => {
    const user = userEvent.setup()
    const conflict = await seed(
      makeConflict({
        envelope: {
          type: 'updateEntry',
          payload: {
            entryId: 'e1',
            slug: 'hello',
            data: { title: { en: 'Hello (mine)', ms: 'Halo' }, body: 'Body', summary: 'Summary' },
          },
          optimisticVersion: 3,
        },
      })
    )
    render(<ConflictResolver open onClose={vi.fn()} conflict={conflict} />)

    await waitFor(() => expect(screen.getAllByTestId('conflict-field')).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Save merge' }))

    await waitFor(async () => expect(await db.commandQueue.get(conflict.id as number)).toBeUndefined())
    expect(schedulerModule.triggerSync).not.toHaveBeenCalled()
  })

  it('offers discard for a queued change it cannot merge field by field', async () => {
    const user = userEvent.setup()
    const conflict = await seed(
      makeConflict({ serverState: undefined, error: 'Command execution failed' })
    )
    render(<ConflictResolver open onClose={vi.fn()} conflict={conflict} />)

    expect(await screen.findByText(/cannot be merged field by field: Command execution failed/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Discard queued change' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))

    await waitFor(async () => expect(await db.commandQueue.get(conflict.id as number)).toBeUndefined())
  })
})
