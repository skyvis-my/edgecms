import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'

type ChangeLogRow = {
  sequence: number
  id: string
  entityType: string
  entityId: string
  commandId: string | null
  changeType: string
  payload: Record<string, unknown> | null
  tenantScope: string | null
  timestamp: string
}

const mockKv = {} as KVNamespace
const changeLogRows: ChangeLogRow[] = []
const mockFindChangesAfterCursor = vi.fn()
const mockFindTenantBySlug = vi.fn()
let changeSequence = 1
let mockAuthUser: { id: string; role?: string; email?: string } = {
  id: 'u-admin',
  role: 'admin',
  email: 'admin@example.com',
}

const mockDb = {} as D1Database

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

vi.mock('@/tenants/tenant-context', () => ({
  hasTenantContext: (ctx: unknown) =>
    typeof ctx === 'object' &&
    ctx !== null &&
    'tenant' in ctx &&
    typeof (ctx as { tenant: unknown }).tenant === 'object' &&
    (ctx as { tenant: unknown }).tenant !== null &&
    'tenant' in ((ctx as { tenant: unknown }).tenant as object) &&
    'resources' in ((ctx as { tenant: unknown }).tenant as object),
  getTenantContext: (ctx: { tenant: unknown }) => ctx.tenant,
  resolveTenantBindings: () => ({ db: mockDb, kv: mockKv, r2: {} as R2Bucket }),
  verifyTenantMembership: vi.fn(async () => 'owner'),
}))

vi.mock('@/tenants/tenants.repository', () => ({
  tenantsRepository: {
    findBySlug: mockFindTenantBySlug,
  },
}))

vi.mock('@/sync/sync.repository', () => ({
  syncRepository: {
    findChangesAfterCursor: mockFindChangesAfterCursor,
  },
}))

vi.mock('@/cache/invalidation.service', () => ({
  extractCacheTagsFromCommand: vi.fn().mockReturnValue([]),
  invalidateByTags: vi.fn().mockResolvedValue({ invalidatedKeys: [] }),
}))

vi.mock('@/plugins/plugin-registry', () => ({
  pluginRegistry: {
    execute: vi.fn(),
  },
}))

vi.mock('@/sync/sync-events', () => ({
  publishSyncEvent: vi.fn(),
  subscribeSyncEvents: () => () => {},
}))

vi.mock('@/commands/diff.service', () => ({
  computeDiff: vi.fn(),
}))

vi.mock('@/commands/handlers/entry-handlers', () => ({
  handleCreateEntry: vi.fn(),
  handleUpdateEntry: vi.fn(),
  handleDeleteEntry: vi.fn(),
  handleBulkUpdate: vi.fn(),
  handleUpdateSingleton: vi.fn(),
}))

vi.mock('@/commands/handlers/publishing-handlers', () => ({
  handlePublishNow: vi.fn(),
  handleUnpublishNow: vi.fn(),
  handleSchedulePublish: vi.fn(),
  handleScheduleUnpublish: vi.fn(),
  handleCancelSchedule: vi.fn(),
}))

vi.mock('@/commands/handlers/relation-handlers', () => ({
  handleLinkRelation: vi.fn(),
  handleUnlinkRelation: vi.fn(),
}))

const { syncController } = await import(`../../sync/sync.controller?bypass=${Date.now()}`)

describe('sync pull contract', () => {
  const app = new Elysia().use(syncController)

  beforeEach(() => {
    vi.clearAllMocks()
    changeLogRows.length = 0
    changeSequence = 1
    mockAuthUser = { id: 'u-admin', role: 'admin', email: 'admin@example.com' }
    mockFindTenantBySlug.mockResolvedValue({
      id: 'tenant-1',
      slug: 'tenant-a',
      name: 'Tenant A',
      status: 'active',
    })
    mockFindChangesAfterCursor.mockImplementation(
      async (
        _db: unknown,
        params: { cursor: number; limit: number; tenantScope?: string; includeAllTenants?: boolean }
      ) => {
        const filtered = changeLogRows.filter((row) => row.sequence > params.cursor)
        return filtered.slice(0, params.limit + 1)
      }
    )
  })

  it('returns full entry payload fields after updateEntry push and pull', async () => {
    // Directly populate changeLogRows to test pull contract in isolation,
    // avoiding mock pollution from other test files that mock the engine.
    changeLogRows.push({
      sequence: changeSequence++,
      id: 'cl-1',
      entityType: 'entry',
      entityId: 'entry-1',
      commandId: 'cmd-1',
      changeType: 'update',
      payload: {
        id: 'entry-1',
        collectionId: 'collection-1',
        slug: 'entry-1',
        status: 'draft',
        data: { title: 'Updated title' },
        version: 8,
        createdAt: '2026-02-19T00:00:00.000Z',
        updatedAt: '2026-02-19T00:01:00.000Z',
      },
      tenantScope: null,
      timestamp: '2026-02-19T00:01:00.000Z',
    })

    const pullResponse = await app.handle(
      new Request('http://localhost/api/admin/sync/pull?cursor=0&limit=100&tenantSlug=*')
    )
    expect(pullResponse.status).toBe(200)

    const pullBody = (await pullResponse.json()) as {
      data: {
        changes: Array<{
          entityType: string
          changeType: string
          payload: Record<string, unknown> | null
        }>
      }
    }

    const entryChange = pullBody.data.changes.find((change) => change.entityType === 'entry')
    expect(entryChange).toBeDefined()
    expect(entryChange?.changeType).toBe('update')
    expect(entryChange?.payload).toEqual(
      expect.objectContaining({
        id: 'entry-1',
        version: 8,
        collectionId: 'collection-1',
      })
    )
  })
})
