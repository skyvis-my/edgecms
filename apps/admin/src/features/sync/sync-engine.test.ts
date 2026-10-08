import { beforeEach, describe, expect, it, vi } from 'bun:test'

const mockedEdenGet = vi.fn()
const mockedEdenPost = vi.fn()
const mockedEdenPut = vi.fn()
const mockedEdenDelete = vi.fn()
const mockedEdenPostForTenant = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenGet: mockedEdenGet,
  edenPost: mockedEdenPost,
  edenPut: mockedEdenPut,
  edenDelete: mockedEdenDelete,
  edenPostForTenant: mockedEdenPostForTenant,
}))

// Mock local-db with chainable Dexie-like API
const mockCommandQueueItems: Array<{
  id: number
  envelope: Record<string, unknown>
  status: string
  createdAt: string
  tenantSlug?: string
}> = []
const mockUpdate = vi.fn().mockResolvedValue(1)
const mockPut = vi.fn().mockResolvedValue(undefined)
const mockDelete = vi.fn().mockResolvedValue(undefined)
const mockBulkPut = vi.fn().mockResolvedValue(undefined)
const mockBulkDelete = vi.fn().mockResolvedValue(undefined)
const mockSyncStateGet = vi.fn().mockResolvedValue({ cursor: 0 })

vi.mock('./local-db', () => ({
  db: {
    commandQueue: {
      where: vi.fn().mockImplementation(() => ({
        equals: vi.fn().mockImplementation(() => ({
          toArray: vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(mockCommandQueueItems.filter((i) => i.status === 'pending'))
            ),
          count: vi.fn().mockResolvedValue(0),
        })),
      })),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    collections: {
      bulkPut: (...args: unknown[]) => mockBulkPut(...args),
      bulkDelete: (...args: unknown[]) => mockBulkDelete(...args),
      put: (...args: unknown[]) => mockPut(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
    entries: {
      bulkPut: (...args: unknown[]) => mockBulkPut(...args),
      bulkDelete: (...args: unknown[]) => mockBulkDelete(...args),
      put: (...args: unknown[]) => mockPut(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
    relations: {
      bulkPut: (...args: unknown[]) => mockBulkPut(...args),
      bulkDelete: (...args: unknown[]) => mockBulkDelete(...args),
      put: (...args: unknown[]) => mockPut(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
    syncState: {
      get: (...args: unknown[]) => mockSyncStateGet(...args),
      put: (...args: unknown[]) => mockPut(...args),
    },
    transaction: vi
      .fn()
      .mockImplementation(async (_mode: string, _tables: unknown, fn: () => Promise<void>) => {
        await fn()
      }),
  },
}))

const { pullChanges, pushPendingCommands, sync } = await import(
  `./sync-engine?bypass=${Date.now()}`
)

describe('pushPendingCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCommandQueueItems.length = 0
  })

  it('returns zero summary when no pending commands', async () => {
    const result = await pushPendingCommands()

    expect(result).toEqual({ synced: 0, conflicted: 0, failed: 0 })
    expect(mockedEdenPostForTenant).not.toHaveBeenCalled()
  })

  it('pushes pending commands to the server', async () => {
    mockCommandQueueItems.push({
      id: 1,
      envelope: { type: 'createEntry', payload: { title: 'Test' } },
      status: 'pending',
      createdAt: '2026-01-15T10:00:00.000Z',
    })

    mockedEdenPostForTenant.mockResolvedValueOnce({
      results: [{ index: 0, status: 'success', data: { id: 'entry-1' } }],
    })

    const result = await pushPendingCommands()

    expect(mockedEdenPostForTenant).toHaveBeenCalledWith(
      '/admin/sync/push',
      {
        commands: [mockCommandQueueItems[0].envelope],
      },
      null
    )
    expect(result.synced).toBe(1)
    expect(result.conflicted).toBe(0)
    expect(result.failed).toBe(0)
  })

  it('handles conflict results correctly', async () => {
    mockCommandQueueItems.push({
      id: 2,
      envelope: { type: 'updateEntry', payload: { entryId: 'e1' } },
      status: 'pending',
      createdAt: '2026-01-15T10:00:00.000Z',
    })

    mockedEdenPostForTenant.mockResolvedValueOnce({
      results: [
        {
          index: 0,
          status: 'conflict',
          serverState: {
            entry: { id: 'e1', title: 'Server title' },
            version: 5,
            conflictingFields: ['title'],
          },
          error: { code: 'VERSION_CONFLICT', message: 'Version mismatch' },
        },
      ],
    })

    const result = await pushPendingCommands()

    expect(result.conflicted).toBe(1)
    expect(mockUpdate).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        status: 'conflicted',
        serverState: {
          entry: { id: 'e1', title: 'Server title' },
          version: 5,
          conflictingFields: ['title'],
        },
        error: 'Version mismatch',
      })
    )
  })

  it('coalesces consecutive updateEntry commands for the same entry', async () => {
    mockCommandQueueItems.push(
      {
        id: 10,
        envelope: {
          type: 'updateEntry',
          payload: { entryId: 'entry-1', data: { title: 'Draft' } },
          timestamp: '2026-01-15T10:00:00.000Z',
        },
        status: 'pending',
        createdAt: '2026-01-15T10:00:00.000Z',
      },
      {
        id: 11,
        envelope: {
          type: 'updateEntry',
          payload: { entryId: 'entry-1', data: { subtitle: 'Hello' }, status: 'published' },
          timestamp: '2026-01-15T10:00:01.000Z',
        },
        status: 'pending',
        createdAt: '2026-01-15T10:00:01.000Z',
      }
    )

    mockedEdenPostForTenant.mockResolvedValueOnce({
      results: [{ index: 0, status: 'success', data: { id: 'entry-1' } }],
    })

    const result = await pushPendingCommands()

    expect(result.synced).toBe(2)
    expect(mockedEdenPostForTenant).toHaveBeenCalledWith(
      '/admin/sync/push',
      {
        commands: [
          {
            type: 'updateEntry',
            payload: {
              entryId: 'entry-1',
              data: { title: 'Draft', subtitle: 'Hello' },
              status: 'published',
            },
            timestamp: '2026-01-15T10:00:01.000Z',
          },
        ],
      },
      null
    )
    expect(mockUpdate).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        status: 'synced',
      })
    )
    expect(mockUpdate).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        status: 'synced',
      })
    )
  })

  it('handles failed results correctly', async () => {
    mockCommandQueueItems.push({
      id: 3,
      envelope: { type: 'deleteEntry', payload: { entryId: 'e1' } },
      status: 'pending',
      createdAt: '2026-01-15T10:00:00.000Z',
    })

    mockedEdenPostForTenant.mockResolvedValueOnce({
      results: [{ index: 0, status: 'failed', error: 'Not found' }],
    })

    const result = await pushPendingCommands()

    expect(result.failed).toBe(1)
  })

  it('reverts commands to pending on network error', async () => {
    mockCommandQueueItems.push({
      id: 4,
      envelope: { type: 'createEntry', payload: {} },
      status: 'pending',
      createdAt: '2026-01-15T10:00:00.000Z',
    })

    mockedEdenPostForTenant.mockRejectedValueOnce(new Error('Network error'))

    await expect(pushPendingCommands()).rejects.toThrow('Network error')

    // Verify commands were reverted to pending
    expect(mockUpdate).toHaveBeenCalledWith(4, { status: 'pending' })
  })

  it('pushes queued commands using each command tenant context', async () => {
    mockCommandQueueItems.push(
      {
        id: 20,
        envelope: { type: 'createEntry', payload: { collectionId: 'col-1' } },
        status: 'pending',
        createdAt: '2026-01-15T10:00:00.000Z',
        tenantSlug: 'tenant-a',
      },
      {
        id: 21,
        envelope: { type: 'createEntry', payload: { collectionId: 'col-2' } },
        status: 'pending',
        createdAt: '2026-01-15T10:00:01.000Z',
        tenantSlug: 'tenant-b',
      }
    )

    mockedEdenPostForTenant.mockResolvedValue({
      results: [{ index: 0, status: 'success', data: { id: 'entry-1' } }],
    })

    const result = await pushPendingCommands()

    expect(result.synced).toBe(2)
    expect(mockedEdenPostForTenant).toHaveBeenCalledTimes(2)
    expect(mockedEdenPostForTenant).toHaveBeenCalledWith(
      '/admin/sync/push',
      {
        commands: [mockCommandQueueItems[0].envelope],
      },
      'tenant-a'
    )
    expect(mockedEdenPostForTenant).toHaveBeenCalledWith(
      '/admin/sync/push',
      {
        commands: [mockCommandQueueItems[1].envelope],
      },
      'tenant-b'
    )
  })

  it('replays httpMutation commands as direct HTTP calls', async () => {
    mockCommandQueueItems.push({
      id: 30,
      envelope: {
        type: 'httpMutation',
        payload: { method: 'POST', path: '/admin/webhooks', body: { url: 'https://example.com' } },
        actor: { userId: 'local', source: 'admin' },
        timestamp: '2026-01-15T10:00:00.000Z',
      },
      status: 'pending',
      createdAt: '2026-01-15T10:00:00.000Z',
    })

    mockedEdenPost.mockResolvedValueOnce({ id: 'w1' })

    const result = await pushPendingCommands()

    expect(mockedEdenPost).toHaveBeenCalledWith('/admin/webhooks', {
      url: 'https://example.com',
    })
    expect(mockedEdenPostForTenant).not.toHaveBeenCalled()
    expect(result.synced).toBe(1)
    expect(mockUpdate).toHaveBeenCalledWith(30, { status: 'syncing' })
    expect(mockUpdate).toHaveBeenCalledWith(
      30,
      expect.objectContaining({ status: 'synced' })
    )
  })

  it('replays httpMutation PUT and DELETE commands', async () => {
    mockCommandQueueItems.push(
      {
        id: 31,
        envelope: {
          type: 'httpMutation',
          payload: { method: 'PUT', path: '/admin/webhooks/w1', body: { status: 'disabled' } },
          actor: { userId: 'local', source: 'admin' },
          timestamp: '2026-01-15T10:00:00.000Z',
        },
        status: 'pending',
        createdAt: '2026-01-15T10:00:00.000Z',
      },
      {
        id: 32,
        envelope: {
          type: 'httpMutation',
          payload: { method: 'DELETE', path: '/admin/webhooks/w2' },
          actor: { userId: 'local', source: 'admin' },
          timestamp: '2026-01-15T10:00:01.000Z',
        },
        status: 'pending',
        createdAt: '2026-01-15T10:00:01.000Z',
      }
    )

    mockedEdenPut.mockResolvedValueOnce({ id: 'w1' })
    mockedEdenDelete.mockResolvedValueOnce(undefined)

    const result = await pushPendingCommands()

    expect(mockedEdenPut).toHaveBeenCalledWith('/admin/webhooks/w1', { status: 'disabled' })
    expect(mockedEdenDelete).toHaveBeenCalledWith('/admin/webhooks/w2')
    expect(result.synced).toBe(2)
  })

  it('marks httpMutation as conflicted on 4xx error', async () => {
    mockCommandQueueItems.push({
      id: 33,
      envelope: {
        type: 'httpMutation',
        payload: { method: 'POST', path: '/admin/webhooks', body: {} },
        actor: { userId: 'local', source: 'admin' },
        timestamp: '2026-01-15T10:00:00.000Z',
      },
      status: 'pending',
      createdAt: '2026-01-15T10:00:00.000Z',
    })

    const clientError = new Error('Bad Request')
    ;(clientError as unknown as { status: number }).status = 400
    mockedEdenPost.mockRejectedValueOnce(clientError)

    const result = await pushPendingCommands()

    expect(result.failed).toBe(1)
    expect(mockUpdate).toHaveBeenCalledWith(
      33,
      expect.objectContaining({ status: 'conflicted', error: 'Bad Request' })
    )
  })

  it('processes httpMutation commands before regular commands', async () => {
    mockCommandQueueItems.push(
      {
        id: 40,
        envelope: {
          type: 'httpMutation',
          payload: { method: 'POST', path: '/admin/webhooks', body: {} },
          actor: { userId: 'local', source: 'admin' },
          timestamp: '2026-01-15T10:00:00.000Z',
        },
        status: 'pending',
        createdAt: '2026-01-15T10:00:00.000Z',
      },
      {
        id: 41,
        envelope: { type: 'createEntry', payload: { collectionId: 'col-1' } },
        status: 'pending',
        createdAt: '2026-01-15T10:00:01.000Z',
      }
    )

    mockedEdenPost.mockResolvedValueOnce({ id: 'w1' })
    mockedEdenPostForTenant.mockResolvedValueOnce({
      results: [{ index: 0, status: 'success', data: { id: 'entry-1' } }],
    })

    const result = await pushPendingCommands()

    expect(result.synced).toBe(2)
    expect(mockedEdenPost).toHaveBeenCalledWith('/admin/webhooks', {})
    expect(mockedEdenPostForTenant).toHaveBeenCalledWith(
      '/admin/sync/push',
      {
        commands: [{ type: 'createEntry', payload: { collectionId: 'col-1' } }],
      },
      null
    )
  })
})

describe('pullChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncStateGet.mockResolvedValue({ cursor: 0 })
  })

  it('fetches changes from server and applies them', async () => {
    mockedEdenGet.mockResolvedValueOnce({
      changes: [
        {
          sequence: 1,
          id: 'cl-1',
          entityType: 'entry',
          entityId: 'entry-1',
          commandId: 'cmd-1',
          changeType: 'create',
          payload: { id: 'entry-1', title: 'New Entry' },
          timestamp: '2026-01-15T10:00:00.000Z',
        },
      ],
      cursor: 1,
      hasMore: false,
    })

    const result = await pullChanges()

    expect(result.changesApplied).toBe(1)
    expect(result.newCursor).toBe(1)
    expect(mockedEdenGet).toHaveBeenCalledWith('/admin/sync/pull?cursor=0&limit=100')
    expect(mockBulkPut).toHaveBeenCalledWith([{ id: 'entry-1', title: 'New Entry' }])
  })

  it('applies collection changes', async () => {
    mockedEdenGet.mockResolvedValueOnce({
      changes: [
        {
          sequence: 1,
          id: 'cl-1',
          entityType: 'collection',
          entityId: 'col-1',
          commandId: 'cmd-1',
          changeType: 'update',
          payload: { id: 'col-1', name: 'Updated' },
          timestamp: '2026-01-15T10:00:00.000Z',
        },
      ],
      cursor: 1,
      hasMore: false,
    })

    await pullChanges()

    expect(mockBulkPut).toHaveBeenCalledWith([{ id: 'col-1', name: 'Updated' }])
  })

  it('handles delete changes', async () => {
    mockedEdenGet.mockResolvedValueOnce({
      changes: [
        {
          sequence: 1,
          id: 'cl-1',
          entityType: 'entry',
          entityId: 'entry-1',
          commandId: 'cmd-1',
          changeType: 'delete',
          payload: {},
          timestamp: '2026-01-15T10:00:00.000Z',
        },
      ],
      cursor: 1,
      hasMore: false,
    })

    await pullChanges()

    expect(mockBulkDelete).toHaveBeenCalledWith(['entry-1'])
  })

  it('returns zero changes when server has none', async () => {
    mockedEdenGet.mockResolvedValueOnce({
      changes: [],
      cursor: 0,
      hasMore: false,
    })

    const result = await pullChanges()

    expect(result.changesApplied).toBe(0)
    expect(result.newCursor).toBe(0)
  })

  it('paginates when hasMore is true', async () => {
    mockedEdenGet
      .mockResolvedValueOnce({
        changes: [
          {
            sequence: 1,
            id: 'cl-1',
            entityType: 'entry',
            entityId: 'e-1',
            commandId: 'cmd-1',
            changeType: 'create',
            payload: { id: 'e-1' },
            timestamp: '2026-01-15T10:00:00.000Z',
          },
        ],
        cursor: 1,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        changes: [
          {
            sequence: 2,
            id: 'cl-2',
            entityType: 'entry',
            entityId: 'e-2',
            commandId: 'cmd-2',
            changeType: 'create',
            payload: { id: 'e-2' },
            timestamp: '2026-01-15T10:00:01.000Z',
          },
        ],
        cursor: 2,
        hasMore: false,
      })

    const result = await pullChanges()

    expect(result.changesApplied).toBe(2)
    expect(result.newCursor).toBe(2)
    expect(mockedEdenGet).toHaveBeenCalledTimes(2)
  })
})

describe('sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCommandQueueItems.length = 0
    mockSyncStateGet.mockResolvedValue({ cursor: 0 })
  })

  it('runs push-before-pull and returns combined summary', async () => {
    // Push: no pending commands
    // Pull: no server changes
    mockedEdenGet.mockResolvedValueOnce({ changes: [], cursor: 0, hasMore: false })

    const result = await sync()

    expect(result.push).toEqual({ synced: 0, conflicted: 0, failed: 0 })
    expect(result.pull).toEqual({ changesApplied: 0, newCursor: 0 })
  })
})
