import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { Elysia } from 'elysia'

const mockDb = {}
const mockKv = {} as KVNamespace
const mockExecuteCommand = vi.fn()
const mockFindEntryById = vi.fn()
const mockFindChangesAfterCursor = vi.fn()
const mockFindLatestSnapshot = vi.fn()
const mockFindExistingChangeLogEntry = vi.fn()
const mockInsertChangeLogEntry = vi.fn()
const mockFindTenantBySlug = vi.fn()
const syncListeners = new Map<string, Set<(event: { type: 'change'; timestamp: string }) => void>>()
let mockAuthUser: { id: string; role?: string; email?: string } = { id: 'u1' }
let mockTenantContext:
  | {
      tenant: {
        id: string
        slug: string
        name: string
        status: string
      }
    }
  | undefined

vi.mock('cloudflare:workers', () => ({
  env: { DB: mockDb, CACHE: mockKv, MEDIA: {} as R2Bucket },
}))

vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia().macro({
    auth: {
      resolve() {
        return { user: mockAuthUser }
      },
    },
  }),
}))

vi.mock('@/commands/engine', () => ({ executeCommand: mockExecuteCommand }))
vi.mock('@/entries/entries.repository', () => ({
  entriesRepository: {
    findById: mockFindEntryById,
  },
}))
mock.module('@/collections/schema-snapshots.repository', () => ({
  schemaSnapshotsRepository: {
    findLatestSnapshot: mockFindLatestSnapshot,
  },
}))
vi.mock('@/sync/sync.repository', () => ({
  syncRepository: {
    findChangesAfterCursor: mockFindChangesAfterCursor,
    findExistingChangeLogEntry: mockFindExistingChangeLogEntry,
    insertChangeLogEntry: mockInsertChangeLogEntry,
  },
}))
vi.mock('@/tenants/tenants.repository', () => ({
  tenantsRepository: {
    findBySlug: mockFindTenantBySlug,
  },
}))
vi.mock('@/sync/sync-events', () => ({
  subscribeSyncEvents: (
    listener: (event: { type: 'change'; timestamp: string }) => void,
    channel = 'global'
  ) => {
    const listeners = syncListeners.get(channel) ?? new Set()
    listeners.add(listener)
    syncListeners.set(channel, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) syncListeners.delete(channel)
    }
  },
  publishSyncEvent: (event: { type: 'change'; timestamp: string }, channel = 'global') => {
    const listeners = syncListeners.get(channel)
    if (!listeners) return
    for (const listener of listeners) listener(event)
  },
}))
vi.mock('@/tenants/tenant-context', () => ({
  hasTenantContext: (ctx: unknown) => {
    if (!mockTenantContext || typeof ctx !== 'object' || ctx === null) return false
    Object.assign(ctx as Record<string, unknown>, { tenant: mockTenantContext })
    return true
  },
  getTenantContext: (ctx: { tenant: unknown }) => ctx.tenant,
  resolveTenantBindings: () => ({ db: mockDb, kv: mockKv, r2: {} as R2Bucket }),
  verifyTenantMembership: vi.fn(async () => 'owner'),
}))

const { syncController } = await import(`../../sync/sync.controller?bypass=${Date.now()}`)
const { publishSyncEvent } = await import('../../sync/sync-events')

describe('syncController', () => {
  const app = new Elysia().use(syncController)

  beforeEach(() => {
    vi.clearAllMocks()
    syncListeners.clear()
    mockTenantContext = undefined
    mockAuthUser = { id: 'u1', role: 'viewer', email: 'viewer@example.com' }
    mockFindEntryById.mockResolvedValue({
      id: 'entry-1',
      version: 7,
      data: { title: 'server title' },
      collectionId: 'c1',
      slug: 'entry-1',
      status: 'draft',
      createdAt: 't',
      updatedAt: 't',
      publishAt: null,
      unpublishAt: null,
    })
    mockFindChangesAfterCursor.mockResolvedValue([])
    mockFindLatestSnapshot.mockResolvedValue(undefined)
    mockFindExistingChangeLogEntry.mockResolvedValue(undefined)
    mockInsertChangeLogEntry.mockResolvedValue(undefined)
    mockFindTenantBySlug.mockResolvedValue({
      id: 'tenant-1',
      slug: 'tenant-a',
      name: 'Tenant A',
      status: 'active',
    })
  })

  it('GET /pull returns change batch and hasMore', async () => {
    const changes = [
      {
        sequence: 1,
        id: 'c1',
        entityType: 'entry',
        entityId: 'e1',
        commandId: 'cmd1',
        changeType: 'create',
        payload: {},
        timestamp: 't1',
      },
      {
        sequence: 2,
        id: 'c2',
        entityType: 'entry',
        entityId: 'e2',
        commandId: 'cmd2',
        changeType: 'update',
        payload: {},
        timestamp: 't2',
      },
    ]

    mockFindChangesAfterCursor.mockResolvedValueOnce(changes)

    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/pull?cursor=0&limit=1')
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { hasMore: boolean; cursor: number } }
    expect(body.data.hasMore).toBe(true)
    expect(body.data.cursor).toBe(1)
    expect(mockFindChangesAfterCursor).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        cursor: 0,
        limit: 1,
        tenantScope: undefined,
        includeAllTenants: false,
      })
    )
  })

  it('GET /pull returns only tenant-scoped changes on tenant routes', async () => {
    mockTenantContext = {
      tenant: {
        id: 'tenant-1',
        slug: 'tenant-a',
        name: 'Tenant A',
        status: 'active',
      },
    }

    const changes = [
      {
        sequence: 1,
        id: 'c1',
        entityType: 'entry',
        entityId: 'e1',
        commandId: 'cmd1',
        changeType: 'create',
        tenantScope: 'tenant-1',
        payload: {},
        timestamp: 't1',
      },
      {
        sequence: 2,
        id: 'c2',
        entityType: 'entry',
        entityId: 'e2',
        commandId: 'cmd2',
        changeType: 'update',
        tenantScope: 'tenant-2',
        payload: {},
        timestamp: 't2',
      },
    ]

    mockFindChangesAfterCursor.mockResolvedValueOnce(changes)

    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/pull?cursor=0&limit=10')
    )
    expect(response.status).toBe(200)
    expect(mockFindChangesAfterCursor).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        tenantScope: 'tenant-1',
        includeAllTenants: false,
      })
    )
    const body = (await response.json()) as { data: { changes: Array<{ tenantScope?: string }> } }
    expect(body.data.changes).toHaveLength(2)
  })

  it('GET /pull rejects tenant selector for non-admin users', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/pull?cursor=0&limit=10&tenantSlug=tenant-a')
    )

    expect(response.status).toBe(403)
  })

  it('GET /pull allows admin users to scope global sync by tenant slug', async () => {
    mockAuthUser = { id: 'u1', role: 'admin', email: 'admin@example.com' }
    mockFindChangesAfterCursor.mockResolvedValueOnce([])

    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/pull?cursor=0&limit=10&tenantSlug=tenant-a')
    )

    expect(response.status).toBe(200)
    expect(mockFindChangesAfterCursor).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        tenantScope: 'tenant-1',
        includeAllTenants: false,
      })
    )
  })

  it('GET /pull allows admin users to sync across all tenants using wildcard selector', async () => {
    mockAuthUser = { id: 'u1', role: 'admin', email: 'admin@example.com' }
    mockFindChangesAfterCursor.mockResolvedValueOnce([])

    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/pull?cursor=0&limit=10&tenantSlug=*')
    )

    expect(response.status).toBe(200)
    expect(mockFindChangesAfterCursor).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        tenantScope: undefined,
        includeAllTenants: true,
      })
    )
  })

  it('POST /push validates non-empty commands', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commands: [] }),
      })
    )

    expect(response.status).toBe(400)
  })

  it('POST /push returns success/conflict/failed statuses', async () => {
    mockExecuteCommand
      .mockResolvedValueOnce({ status: 'success', data: { id: 'ok' } })
      .mockResolvedValueOnce({
        status: 'failed',
        error: { code: 'VERSION_CONFLICT', message: 'conflict' },
        data: { server: true },
      })
      .mockResolvedValueOnce({
        status: 'failed',
        error: { code: 'INTERNAL_ERROR', message: 'nope' },
      })

    const commands = [
      {
        type: 'createEntry',
        payload: {},
        actor: { userId: 'x', source: 'sync' },
        timestamp: new Date().toISOString(),
      },
      {
        type: 'updateEntry',
        payload: { entryId: 'entry-1', data: { title: 'client title' } },
        actor: { userId: 'x', source: 'sync' },
        timestamp: new Date().toISOString(),
      },
      {
        type: 'deleteEntry',
        payload: {},
        actor: { userId: 'x', source: 'sync' },
        timestamp: new Date().toISOString(),
      },
    ]

    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commands }),
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { results: Array<{ status: string; error?: { code: string } }> }
    }
    expect(body.data.results[0]?.status).toBe('success')
    expect(body.data.results[1]?.status).toBe('conflict')
    expect(body.data.results[1]).toEqual(
      expect.objectContaining({
        status: 'conflict',
        serverState: expect.objectContaining({
          version: 7,
          conflictingFields: ['title'],
        }),
      })
    )
    expect(body.data.results[2]?.status).toBe('failed')
    expect(mockExecuteCommand).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({
        actor: { userId: 'u1', source: 'sync' },
      })
    )
  })

  it('POST /push executes commands sequentially', async () => {
    let inFlight = 0
    let maxInFlight = 0

    mockExecuteCommand.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return { status: 'success', data: {} }
    })

    const commands = [
      {
        type: 'createEntry',
        payload: {},
        actor: { userId: 'x', source: 'admin' },
        timestamp: new Date().toISOString(),
      },
      {
        type: 'updateEntry',
        payload: {},
        actor: { userId: 'x', source: 'sync' },
        timestamp: new Date().toISOString(),
      },
      {
        type: 'deleteEntry',
        payload: {},
        actor: { userId: 'x', source: 'ai' },
        timestamp: new Date().toISOString(),
      },
    ]

    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commands }),
      })
    )

    expect(response.status).toBe(200)
    expect(maxInFlight).toBe(1)
  })

  it('POST /push rejects oversized batches', async () => {
    const commands = Array.from({ length: 101 }, () => ({
      type: 'updateEntry',
      payload: { entryId: 'e1', data: {} },
      timestamp: new Date().toISOString(),
    }))

    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commands }),
      })
    )

    expect(response.status).toBe(400)
  })

  it('POST /push catches thrown execution errors', async () => {
    mockExecuteCommand.mockRejectedValueOnce(new Error('boom'))

    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          commands: [
            {
              type: 'createEntry',
              payload: {},
              actor: { userId: 'x', source: 'sync' },
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      })
    )

    const body = (await response.json()) as {
      data: { results: Array<{ status: string; error: { code: string } }> }
    }
    expect(body.data.results[0]?.status).toBe('failed')
    expect(body.data.results[0]?.error.code).toBe('INTERNAL_ERROR')
  })

  it('GET /stream returns SSE and streams change events', async () => {
    const response = await app.handle(new Request('http://localhost/api/admin/sync/stream'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    if (!reader) {
      throw new Error('Expected stream reader')
    }

    const decoder = new TextDecoder()
    const initial = await reader.read()
    const initialChunk = decoder.decode(initial.value ?? new Uint8Array())
    expect(initialChunk).toContain('event: connected')

    publishSyncEvent({
      type: 'change',
      timestamp: new Date().toISOString(),
    })

    const change = await reader.read()
    const changeChunk = decoder.decode(change.value ?? new Uint8Array())
    expect(changeChunk).toContain('event: change')
    expect(changeChunk).toContain('"type":"change"')

    await reader.cancel()
  })

  it('GET /stream buffers published events before flushing to SSE', async () => {
    const response = await app.handle(new Request('http://localhost/api/admin/sync/stream'))

    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    if (!reader) {
      throw new Error('Expected stream reader')
    }

    const decoder = new TextDecoder()
    await reader.read() // connected event

    publishSyncEvent({
      type: 'change',
      timestamp: new Date().toISOString(),
    })

    let settled = false
    const pendingRead = reader.read().then((chunk) => {
      settled = true
      return chunk
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    const flushed = await pendingRead
    const flushedChunk = decoder.decode(flushed.value ?? new Uint8Array())
    expect(flushedChunk).toContain('event: change')

    await reader.cancel()
  })

  it('GET /stream rejects tenant selector for non-admin users', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/stream?tenantSlug=tenant-a')
    )
    expect(response.status).toBe(403)
  })

  it('GET /stream allows admin users to subscribe to tenant-scoped channel from global route', async () => {
    mockAuthUser = { id: 'u1', role: 'admin', email: 'admin@example.com' }
    const response = await app.handle(
      new Request('http://localhost/api/admin/sync/stream?tenantSlug=tenant-a')
    )

    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    expect(reader).toBeDefined()
    if (!reader) throw new Error('Expected stream reader')
    await reader.read() // connected event

    publishSyncEvent(
      {
        type: 'change',
        timestamp: new Date().toISOString(),
      },
      'tenant-1'
    )

    const decoder = new TextDecoder()
    const chunk = await reader.read()
    expect(decoder.decode(chunk.value ?? new Uint8Array())).toContain('event: change')
    await reader.cancel()
  })
})
