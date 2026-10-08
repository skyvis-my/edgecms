import type { CommandEnvelope } from '@/features/commands/command-builder'

const { queueCommand } = await import(`./queue-command?bypass=${Date.now()}`)

const mockAdd = vi.fn().mockResolvedValue(1)
const mockRefreshCounts = vi.fn().mockResolvedValue(undefined)

vi.mock('./local-db', () => ({
  db: {
    commandQueue: {
      add: (...args: unknown[]) => mockAdd(...args),
      where: vi.fn(),
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
})
