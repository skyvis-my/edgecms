import type { CommandEnvelope } from '@/features/commands/command-builder'

const { attachConflictBase, queueCommand } = await import(`./queue-command?bypass=${Date.now()}`)

const mockAdd = vi.fn().mockResolvedValue(1)
const mockRefreshCounts = vi.fn().mockResolvedValue(undefined)
const mockEntryGet = vi.fn().mockResolvedValue(undefined)

vi.mock('./local-db', () => ({
  db: {
    commandQueue: {
      add: (...args: unknown[]) => mockAdd(...args),
      where: vi.fn(),
    },
    entries: {
      get: (...args: unknown[]) => mockEntryGet(...args),
    },
  },
}))

vi.mock('./sync-store', () => ({
  useSyncStore: {
    getState: () => ({
      refreshCounts: mockRefreshCounts,
    }),
  },
}))

const makeEnvelope = (type = 'createEntry'): CommandEnvelope => ({
  type: type as CommandEnvelope['type'],
  payload: { collectionId: 'col-1', data: { title: 'Test' } },
  actor: { userId: 'current-user', source: 'admin' },
  timestamp: '2026-01-15T10:00:00.000Z',
})

describe('queueCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('adds a command to the Dexie queue with pending status', async () => {
    localStorage.setItem('edgecms:active-tenant', 'acme')
    const envelope = makeEnvelope()

    await queueCommand(envelope)

    expect(mockAdd).toHaveBeenCalledTimes(1)
    const addCall = mockAdd.mock.calls[0][0]
    expect(addCall.envelope).toEqual(envelope)
    expect(addCall.tenantSlug).toBe('acme')
    expect(addCall.status).toBe('pending')
    expect(addCall.createdAt).toBeDefined()
  })

  it('refreshes sync store counts after queuing', async () => {
    await queueCommand(makeEnvelope())

    expect(mockRefreshCounts).toHaveBeenCalledTimes(1)
  })

  it('throws if add fails', async () => {
    mockAdd.mockRejectedValueOnce(new Error('IndexedDB error'))

    await expect(queueCommand(makeEnvelope())).rejects.toThrow('IndexedDB error')
  })

  describe('conflict base snapshot (OF-04)', () => {
    const makeUpdate = (version: number): CommandEnvelope => ({
      type: 'updateEntry',
      payload: { entryId: 'e1', slug: 'hello', data: { title: 'Mine' } },
      actor: { userId: 'current-user', source: 'admin' },
      timestamp: '2026-01-15T10:00:00.000Z',
      optimisticVersion: version,
    })

    it('stores the base attached by the editor beside the queued row', async () => {
      const envelope = makeUpdate(3)
      attachConflictBase(envelope, { version: 3, slug: 'hello', data: { title: 'Base' } })
      await queueCommand(envelope)
      const row = mockAdd.mock.calls[0][0]
      expect(row.base).toEqual({ version: 3, slug: 'hello', data: { title: 'Base' } })
      // The base is local only: the envelope that will be pushed is unchanged.
      expect(row.envelope).toEqual(envelope)
      expect('base' in row.envelope).toBe(false)
    })

    it('falls back to the local entry mirror when it matches the expected version', async () => {
      mockEntryGet.mockResolvedValueOnce({ id: 'e1', version: 4, slug: 's', data: { title: 'Mirror' } })
      await queueCommand(makeUpdate(4))
      expect(mockAdd.mock.calls[0][0].base).toEqual({ version: 4, slug: 's', data: { title: 'Mirror' } })
    })

    it('stores no base when the mirror is at a different version', async () => {
      mockEntryGet.mockResolvedValueOnce({ id: 'e1', version: 5, slug: 's', data: { title: 'Newer' } })
      await queueCommand(makeUpdate(4))
      expect(mockAdd.mock.calls[0][0].base).toBeUndefined()
    })

    it('ignores an attached base for a different version', async () => {
      const envelope = makeUpdate(6)
      attachConflictBase(envelope, { version: 2, data: { title: 'Stale' } })
      await queueCommand(envelope)
      expect(mockAdd.mock.calls[0][0].base).toBeUndefined()
    })
  })
})
