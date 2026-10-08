import { afterAll, afterEach, beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { requiresAuthorizationCheck } from '@/auth/authorization'
import { createSignedCsrfToken, requiresCsrf } from '@/auth/csrf.middleware'
import {
  DEFAULT_ASSET_ALLOWED_MIME_TYPES,
  normalizeAllowedAssetMimeTypes,
} from '@/assets/file-policy'
import type { Env } from '@/env'
import { normalizeTenantScopedPath } from '@/tenants/tenant-path-normalizer'
import {
  API_ROUTE_MANIFEST,
  EXPECTED_REGISTERED_ROUTE_SIGNATURES,
  deriveRouteSecurity,
} from './api-route-manifest'
import { runBenchmarkCase, type BenchmarkCase } from './benchmark-harness'

const mockSession = {
  user: {
    id: 'bench-user-1',
    name: 'Bench User',
    email: 'bench@example.com',
    role: 'super_admin',
  },
  session: {
    id: 'bench-session-1',
    role: 'super_admin',
  },
}

const mockAuthHandler = vi.fn(() => new Response('Not Found', { status: 404 }))
const mockGetSession = vi.fn(async () => mockSession)
const mockPublicService = {
  getCollectionList: vi.fn(async () => ({
    success: true,
    data: {
      payload: { data: [], meta: { pagination: { total: 0, page: 1, perPage: 20 } } },
      cache: {
        cacheTag: 'collection:articles',
        browserTTL: 60,
        cdnTTL: 120,
        debugHeaders: { 'x-edgecms-cache': 'bench-hit' },
      },
    },
  })),
  getCollectionEntry: vi.fn(async () => ({
    success: true,
    data: {
      payload: { id: 'entry-1', slug: 'entry-1' },
      cache: { cacheTag: 'entry:entry-1', browserTTL: 60, cdnTTL: 120 },
    },
  })),
  getSingletonEntry: vi.fn(async () => ({
    success: true,
    data: {
      payload: { id: 'singleton-1', slug: 'home' },
      cache: { cacheTag: 'singleton:home', browserTTL: 60, cdnTTL: 120 },
    },
  })),
  getAssetVariant: vi.fn(async () => ({
    success: false,
    error: { status: 404, message: 'Asset variant not found' },
  })),
}
const mockEntriesService = {
  findAllWithLocaleAndPopulate: vi.fn(async () => ({
    success: true,
    data: { entries: [], total: 0, page: 1, perPage: 20 },
  })),
  findByIdWithLocaleAndPopulate: vi.fn(async () => ({
    success: true,
    data: { id: 'entry-1' },
  })),
  findByIds: vi.fn(async () => ({ success: true, data: [] })),
  duplicate: vi.fn(async () => ({ success: true, data: { id: 'entry-copy' } })),
  create: vi.fn(async () => ({ success: true, data: { id: 'entry-1' } })),
  update: vi.fn(async () => ({ success: true, data: { id: 'entry-1' } })),
  deleteById: vi.fn(async () => ({ success: true, data: { id: 'entry-1' } })),
}
const mockCollectionsService = {
  findAll: vi.fn(async () => ({ success: true, data: [] })),
  findByIdOrSlug: vi.fn(async () => ({ success: true, data: { id: 'collection-1', slug: 'articles' } })),
  create: vi.fn(async () => ({ success: true, data: { id: 'collection-1', slug: 'articles' } })),
  update: vi.fn(async () => ({ success: true, data: { id: 'collection-1', slug: 'articles' } })),
  deleteById: vi.fn(async () => ({ success: true, data: { id: 'collection-1' } })),
}
const mockTenant = {
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  localeCatalog: ['en'],
  targetUrl: 'https://acme.example.com',
  corsOrigin: 'https://admin.acme.example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const mockTenantsService = {
  findAll: vi.fn(async () => ({ success: true, data: [mockTenant] })),
  findByIdOrSlug: vi.fn(async () => ({ success: true, data: mockTenant })),
  findByIdOrSlugWithUsers: vi.fn(async () => ({ success: true, data: { ...mockTenant, users: [] } })),
  create: vi.fn(async () => ({ success: true, data: mockTenant })),
  update: vi.fn(async () => ({ success: true, data: mockTenant })),
  deleteBySlug: vi.fn(async () => ({ success: true, data: { slug: 'acme' } })),
  deleteById: vi.fn(async () => ({ success: true, data: { id: 'tenant-1' } })),
  findTenantUsersWithDetails: vi.fn(async () => ({ success: true, data: [] })),
  addUser: vi.fn(async () => ({ success: true, data: { tenantId: 'tenant-1', userId: 'bench-user-1' } })),
  addUserToTenant: vi.fn(async () => ({
    success: true,
    data: { tenantId: 'tenant-1', userId: 'bench-user-1', role: 'member' },
  })),
  removeUser: vi.fn(async () => ({ success: true, data: { tenantId: 'tenant-1', userId: 'bench-user-1' } })),
  removeUserFromTenant: vi.fn(async () => ({
    success: true,
    data: { tenantId: 'tenant-1', userId: 'bench-user-1' },
  })),
  updateUserRole: vi.fn(async () => ({
    success: true,
    data: { tenantId: 'tenant-1', userId: 'bench-user-1', role: 'owner' },
  })),
}
const mockTenantsRepository = {
  findBySlug: vi.fn(async () => mockTenant),
  findTenantUser: vi.fn(async () => ({ tenantId: 'tenant-1', userId: 'bench-user-1', role: 'owner' })),
  findMembershipRole: vi.fn(async () => 'owner'),
}
const mockSystemService = {
  getStats: vi.fn(async () => ({ success: true, data: { collections: 0, entries: 0, assets: 0 } })),
}
const mockAssetsService = {
  list: vi.fn(async () => []),
  getById: vi.fn(async () => ({ id: 'asset-1', filename: 'hero.jpg' })),
  updateFilename: vi.fn(async () => ({ id: 'asset-1', filename: 'hero-updated.jpg' })),
  semanticSearch: vi.fn(async () => []),
}
const mockRelationsService = {
  link: vi.fn(async () => ({ success: true, data: { id: 'relation-1' } })),
  unlink: vi.fn(async () => ({ success: true, data: { id: 'relation-1' } })),
  getRelationsForEntry: vi.fn(async () => ({ success: true, data: [] })),
}
const mockUsersService = {
  findAdminUsers: vi.fn(async () => []),
}
const mockUsersRepository = {
  countAll: vi.fn(async () => 1),
  findRoleById: vi.fn(async () => 'admin'),
  findFirstUserId: vi.fn(async () => 'bench-user-1'),
}
const mockEnsureUserHasOnboardingTenant = vi.fn(async () => ({
  success: true,
  data: { tenant: mockTenant, userId: 'bench-user-1' },
}))
const mockVersioningService = {
  listVersions: vi.fn(async () => ({ success: true, data: { versions: [], total: 0, page: 1, limit: 20 } })),
  getVersion: vi.fn(async () => ({ success: true, data: { id: 'version-1', version: 1 } })),
  diffVersions: vi.fn(async () => ({ success: true, data: { changes: [] } })),
  rollback: vi.fn(async () => ({
    success: true,
    data: { entry: { id: 'entry-1' }, newVersion: { id: 'version-2', version: 2 } },
  })),
}
const mockExecuteCommand = vi.fn(async () => ({
  status: 'dry_run',
  type: 'updateEntry',
  commandId: 'command-1',
}))
function normalizeBenchmarkSyncPullLimit(limit?: number): number {
  return Math.min(limit ?? 100, 500)
}

function buildBenchmarkSyncPullPayload(
  changes: Array<{
    sequence: number
    id: string
    entityType: string
    entityId: string
    commandId: string | null
    changeType: string
    payload: Record<string, unknown> | null
    timestamp: string
  }>,
  cursor: number,
  limit: number
) {
  const hasMore = changes.length > limit
  const returnedChanges = hasMore ? changes.slice(0, limit) : changes
  const lastChange = returnedChanges[returnedChanges.length - 1]
  return {
    changes: returnedChanges,
    cursor: lastChange?.sequence ?? cursor,
    hasMore,
  }
}

async function pullBenchmarkSyncChanges(params: {
  db: unknown
  cursor: number
  limit: number
  tenantScope?: string
  includeAllTenants?: boolean
}) {
  if (params.db === mockWorkerEnv.DB) {
    return { changes: [], cursor: 0, hasMore: false }
  }

  if (!params.includeAllTenants) {
    const { schemaSnapshotsRepository } = await import('@/collections/schema-snapshots.repository')
    const { syncRepository } = await import('@/sync/sync.repository')
    const snapshot = await schemaSnapshotsRepository.findLatestSnapshot(
      params.db as never,
      params.tenantScope ?? 'global'
    )
    if (snapshot) {
      const existing = await syncRepository.findExistingChangeLogEntry(params.db as never, {
        entityType: 'schema_snapshot',
        entityId: snapshot.id,
        tenantScope: params.tenantScope,
      })
      if (!existing) {
        await syncRepository.insertChangeLogEntry(params.db as never, {
          id: crypto.randomUUID(),
          entityType: 'schema_snapshot',
          entityId: snapshot.id,
          commandId: null,
          changeType: 'upsert',
          tenantScope: params.tenantScope ?? null,
          payload: {
            id: snapshot.id,
            tenantId: snapshot.tenantId,
            schemaVersion: snapshot.schemaVersion,
            payload: snapshot.payload,
            createdAt: snapshot.createdAt,
          },
          timestamp: new Date().toISOString(),
        })
      }
    }
  }

  const { syncRepository } = await import('@/sync/sync.repository')
  const changes = await syncRepository.findChangesAfterCursor(params.db as never, {
    cursor: params.cursor,
    limit: params.limit,
    tenantScope: params.tenantScope,
    includeAllTenants: params.includeAllTenants ?? false,
  })
  return buildBenchmarkSyncPullPayload(
    changes.map((change) => ({
      sequence: change.sequence,
      id: change.id,
      entityType: change.entityType,
      entityId: change.entityId,
      commandId: change.commandId,
      changeType: change.changeType,
      payload: change.payload,
      timestamp: change.timestamp,
    })),
    params.cursor,
    params.limit
  )
}

async function executeBenchmarkSyncPushCommands(params: {
  commands: Array<{
    type: string
    payload: Record<string, unknown>
    timestamp?: string
    optimisticVersion?: number
    dryRun?: boolean
    transactionId?: string
  }>
  userId: string
  db: unknown
  kv: KVNamespace
  syncChannel: string
  executeCommandFn: (ctx: unknown, command: Record<string, unknown>) => Promise<{
    status: string
    data?: Record<string, unknown>
    error?: { code?: string; message?: string }
  }>
  findEntryByIdFn?: (db: unknown, id: string) => Promise<Record<string, unknown> | undefined>
}) {
  if (params.db === mockWorkerEnv.DB) {
    return [{ index: 0, status: 'success' as const, data: { commandId: 'command-1' } }]
  }

  const results = []
  for (const [index, command] of params.commands.entries()) {
    try {
      const enrichedCommand = {
        type: command.type,
        payload: command.payload,
        actor: { userId: params.userId, source: 'sync' },
        timestamp: command.timestamp ?? new Date().toISOString(),
        optimisticVersion: command.optimisticVersion,
        dryRun: command.dryRun,
        transactionId: command.transactionId,
      }
      const result = await params.executeCommandFn(
        {
          db: params.db,
          actor: enrichedCommand.actor,
          kv: params.kv,
          syncChannel: params.syncChannel,
        },
        enrichedCommand
      )
      if (result.status === 'failed' && result.error?.code === 'VERSION_CONFLICT') {
        const entryId =
          typeof command.payload.entryId === 'string' ? command.payload.entryId : undefined
        const findEntryByIdFn =
          params.findEntryByIdFn ??
          (async (db: unknown, id: string) => {
            const { entriesRepository } = await import('@/entries/entries.repository')
            return entriesRepository.findById(db as never, id)
          })
        const latestEntry = entryId ? await findEntryByIdFn(params.db, entryId) : undefined
        const data = command.payload.data
        results.push({
          index,
          status: 'conflict',
          error: result.error,
          serverState: latestEntry
            ? {
                entry: latestEntry,
                version: latestEntry.version,
                conflictingFields:
                  data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [],
              }
            : undefined,
        })
        continue
      }
      if (result.status === 'success') {
        results.push({ index, status: 'success', data: result.data })
        continue
      }
      results.push({ index, status: 'failed', error: result.error })
    } catch (error) {
      results.push({
        index,
        status: 'failed',
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown error' },
      })
    }
  }
  return results
}

const mockSyncService = {
  MAX_SYNC_PULL_LIMIT: 500,
  normalizeSyncPullLimit: vi.fn(normalizeBenchmarkSyncPullLimit),
  buildSyncPullPayload: vi.fn(buildBenchmarkSyncPullPayload),
  pullSyncChanges: vi.fn(pullBenchmarkSyncChanges),
  executeSyncPushCommands: vi.fn(executeBenchmarkSyncPushCommands),
}
const mockWebhooksService = {
  findAll: vi.fn(async () => ({ success: true, data: [] })),
  create: vi.fn(async () => ({ success: true, data: { id: 'webhook-1', url: 'https://example.com/hook' } })),
  findById: vi.fn(async () => ({ success: true, data: { id: 'webhook-1', url: 'https://example.com/hook' } })),
  update: vi.fn(async () => ({ success: true, data: { id: 'webhook-1', url: 'https://example.com/hook' } })),
  deleteById: vi.fn(async () => ({ success: true, data: { id: 'webhook-1' } })),
  testDelivery: vi.fn(async () => ({ success: true, data: { status: 'queued' } })),
  getDeliveries: vi.fn(async () => ({ success: true, data: { deliveries: [], total: 0 } })),
}
const mockRbacService = {
  getRolesForTenant: vi.fn(async () => ({
    success: true,
    data: [{ id: 'role-owner', name: 'owner', description: 'Owner' }],
  })),
  getEffectivePermissions: vi.fn(async () => ({
    success: true,
    data: [{ subject: 'entries', action: 'read' }],
  })),
}

function createMockD1Statement(): D1PreparedStatement {
  const statement = {
    bind: vi.fn(() => statement),
    first: vi.fn(async () => ({ ok: 1, role: 'owner', id: 'tenant-1', count: 1 })),
    all: vi.fn(async () => ({ results: [] })),
    run: vi.fn(async () => ({ success: true })),
    raw: vi.fn(async () => []),
  }
  return statement as unknown as D1PreparedStatement
}

function createMockD1(): D1Database {
  return {
    prepare: vi.fn(() => createMockD1Statement()),
    batch: vi.fn(async () => []),
    dump: vi.fn(async () => new ArrayBuffer(0)),
    exec: vi.fn(async () => ({ count: 0, duration: 0 })),
  } as unknown as D1Database
}

function createMockKV(): KVNamespace {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: undefined })),
  } as unknown as KVNamespace
}

function createMockR2(): R2Bucket {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ objects: [], truncated: false })),
  } as unknown as R2Bucket
}

const mockWorkerEnv: Env = {
  DB: createMockD1(),
  CACHE: createMockKV(),
  MEDIA: createMockR2(),
  ASSETS: {
    fetch: vi.fn(async () => new Response('Not Found', { status: 404 })),
  } as unknown as Fetcher,
  PUBLISH_SCHEDULER: {} as DurableObjectNamespace,
  WEBHOOK_QUEUE: {
    send: vi.fn(async () => undefined),
  } as unknown as Queue,
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters',
  JWT_HS256_SECRET: undefined,
  JWT_ISSUER: undefined,
  JWT_AUDIENCE: undefined,
  JWT_REQUIRED_FOR_ADMIN: undefined,
  EDGE_PLUGINS_JSON: undefined,
  EDGE_PLUGIN_HOOK_TIMEOUT_MS: undefined,
  WEBHOOK_ALLOWED_HOSTS: 'localhost,example.com',
  SUPER_ADMIN_EMAILS: 'bench@example.com',
}

function installBenchmarkModuleMocks(): void {
  mock.module('cloudflare:workers', () => ({
    env: mockWorkerEnv,
  }))

  mock.module('@/auth/auth', () => ({
    createAuth: vi.fn(() => ({
      handler: mockAuthHandler,
      api: {
        getSession: mockGetSession,
      },
    })),
  }))

  mock.module('@/public/public.service', () => ({
    publicService: mockPublicService,
  }))

  mock.module('@/entries/entries.service', () => ({
    entriesService: mockEntriesService,
  }))

  mock.module('@/collections/collections.service', () => ({
    collectionsService: mockCollectionsService,
  }))

  mock.module('@/tenants/tenants.service', () => ({
    tenantsService: mockTenantsService,
  }))

  mock.module('@/tenants/tenants.repository', () => ({
    tenantsRepository: mockTenantsRepository,
  }))

  mock.module('../../tenants/tenants.repository', () => ({
    tenantsRepository: mockTenantsRepository,
  }))

  mock.module('@/tenants/tenant-context', () => ({
    hasTenantContext: (ctx: unknown) => {
      return (
        typeof ctx === 'object' &&
        ctx !== null &&
        'tenant' in ctx &&
        typeof (ctx as { tenant: unknown }).tenant === 'object' &&
        (ctx as { tenant: unknown }).tenant !== null &&
        'tenant' in ((ctx as { tenant: unknown }).tenant as object) &&
        'resources' in ((ctx as { tenant: unknown }).tenant as object)
      )
    },
    getTenantContext: (ctx: { tenant: unknown }) => ctx.tenant,
    resolveTenantBindings: () => ({
      db: mockWorkerEnv.DB,
      kv: mockWorkerEnv.CACHE,
      r2: mockWorkerEnv.MEDIA,
    }),
    verifyTenantMembership: vi.fn(async () => 'owner'),
  }))

  mock.module('@/system/system.service', () => ({
    systemService: mockSystemService,
  }))

  mock.module('@/assets/assets.service', () => ({
    assetsService: mockAssetsService,
    DEFAULT_ASSET_UPLOAD_MAX_BYTES: 5 * 1024 * 1024,
    DEFAULT_ASSET_UPLOAD_MAX_DIMENSION: 2048,
    DEFAULT_ASSET_ALLOWED_MIME_TYPES,
    normalizeAllowedAssetMimeTypes,
  }))

  mock.module('@/relations/relations.service', () => ({
    relationsService: mockRelationsService,
  }))

  mock.module('@/users/users.service', () => ({
    usersService: mockUsersService,
  }))

  mock.module('@/users/users.repository', () => ({
    usersRepository: mockUsersRepository,
  }))

  mock.module('@/bootstrap/onboarding-tenant', () => ({
    ensureUserHasOnboardingTenant: mockEnsureUserHasOnboardingTenant,
  }))

  mock.module('@/versioning/versioning.service', () => ({
    versioningService: mockVersioningService,
  }))

  mock.module('@/commands/engine', () => ({
    executeCommand: mockExecuteCommand,
  }))

  mock.module('@/auth/rbac.service', () => ({
    rbacService: mockRbacService,
  }))

  mock.module('@/cache/kv.service', () => ({
    kvService: {
      getMemoryCacheStats: vi.fn(() => ({
        entryCount: 0,
        sizeBytes: 0,
        maxSizeBytes: 1,
      })),
    },
  }))

  mock.module('@/plugins/plugin-registry', () => ({
    pluginRegistry: {
      register: vi.fn(),
      execute: vi.fn(async () => undefined),
      isPluginEnabled: vi.fn(async () => true),
      setPluginEnabled: vi.fn(async () => undefined),
      setHookTimeoutMs: vi.fn(),
      getHookTimeoutMs: vi.fn(() => 250),
      clear: vi.fn(),
    },
  }))

  mock.module('@/sync/sync.service', () => mockSyncService)

  mock.module('@/webhooks/webhooks.service', () => ({
    webhooksService: mockWebhooksService,
  }))
}

type AppInstance = {
  handle: (request: Request) => Promise<Response>
  router?: {
    history?: Array<{ method: string; path: string }>
  }
}

type AppModule = {
  createApp: () => AppInstance
  classifyCorsSurface: (pathname: string) => 'admin' | 'public' | 'none'
}

async function importAppModule(): Promise<AppModule> {
  const mod = await import(`@/app?bench=${Date.now()}`)
  return mod as AppModule
}

async function importCreateApp(): Promise<() => AppInstance> {
  return (await importAppModule()).createApp
}

function routeSignatures(app: AppInstance): string[] {
  return (app.router?.history ?? []).map((route) => `${route.method} ${route.path}`)
}

function sampleManifestPath(path: string): string {
  if (path === '/*') return '/api/unknown-route'
  return path
    .replace(':tenantSlug', 'acme')
    .replace(':pluginName', 'audit-trace')
    .replace(':collection', 'articles')
    .replace(':idOrSlug', 'entry-1')
    .replace(':variant', 'thumb')
    .replace(':format', 'webp')
    .replace(':slug', 'acme')
    .replace(':userId', 'bench-user-1')
    .replace(':id', 'entry-1')
    .replace(':entryId', 'entry-1')
    .replace(':versionId', 'version-1')
    .replace(':targetVersionId', 'version-2')
    .replace(':roleId', 'role-owner')
}

let currentJsonHeaders: HeadersInit = { 'content-type': 'application/json' }

function jsonHeaders(): HeadersInit {
  return currentJsonHeaders
}

function parseJsonBody(body: string): unknown {
  return JSON.parse(body)
}

function expectSuccessEnvelope(body: string): void {
  const parsed = parseJsonBody(body) as { success?: unknown }
  expect(parsed.success).toBe(true)
}

function expectErrorEnvelope(body: string): void {
  const parsed = parseJsonBody(body) as { success?: unknown; error?: unknown }
  expect(parsed.success).toBe(false)
  expect(parsed.error).toBeDefined()
}

describe('API in-process benchmark contract', () => {
  beforeEach(async () => {
    installBenchmarkModuleMocks()
    vi.clearAllMocks()
    mockWorkerEnv.DB = createMockD1()
    mockWorkerEnv.CACHE = createMockKV()
    mockPublicService.getCollectionList.mockClear()
    mockPublicService.getCollectionEntry.mockClear()
    mockPublicService.getSingletonEntry.mockClear()
    mockEntriesService.findAllWithLocaleAndPopulate.mockClear()
    mockCollectionsService.findAll.mockClear()
    mockTenantsService.findAll.mockClear()
    mockTenantsService.findTenantUsersWithDetails.mockClear()
    mockTenantsRepository.findBySlug.mockClear()
    mockTenantsRepository.findMembershipRole.mockClear()
    mockSystemService.getStats.mockClear()
    mockAssetsService.list.mockClear()
    mockRelationsService.getRelationsForEntry.mockClear()
    mockUsersService.findAdminUsers.mockClear()
    mockUsersRepository.countAll.mockClear()
    mockUsersRepository.findRoleById.mockClear()
    mockUsersRepository.findFirstUserId.mockClear()
    mockEnsureUserHasOnboardingTenant.mockClear()
    mockVersioningService.listVersions.mockClear()
    mockExecuteCommand.mockClear()
    mockSyncService.pullSyncChanges.mockClear()
    mockWebhooksService.findAll.mockClear()
    mockRbacService.getRolesForTenant.mockClear()
    const token = await createSignedCsrfToken(mockWorkerEnv.BETTER_AUTH_SECRET!)
    currentJsonHeaders = {
      'content-type': 'application/json',
      'x-csrf-token': token,
      cookie: `csrf_token=${token}`,
    }
    const rateLimit = await import('@/auth/rate-limit.middleware')
    rateLimit.__resetRateLimitState()
  })

  afterAll(() => {
    mock.restore()
  })

  afterEach(() => {
    mock.restore()
  })

  it('keeps a manifest for all first-party API route classes', async () => {
    const appModule = await importAppModule()
    const app = appModule.createApp()
    const registered = routeSignatures(app)

    expect(API_ROUTE_MANIFEST.length).toBeGreaterThan(40)
    expect(API_ROUTE_MANIFEST.some((entry) => entry.routeClass === 'auth-generated')).toBe(true)
    expect(API_ROUTE_MANIFEST.some((entry) => entry.routeClass === 'tenant-admin')).toBe(true)
    expect(API_ROUTE_MANIFEST.some((entry) => entry.routeClass === 'plugin-generated')).toBe(true)
    expect(API_ROUTE_MANIFEST.some((entry) => entry.routeClass === 'stream')).toBe(true)
    expect(API_ROUTE_MANIFEST.some((entry) => entry.benchmarkStatus === 'special-class')).toBe(true)
    expect(API_ROUTE_MANIFEST.filter((entry) => entry.benchmarkStatus === 'fixture-required')).toEqual([])
    expect(API_ROUTE_MANIFEST.filter((entry) => entry.method.includes('|'))).toEqual([])
    for (const entry of API_ROUTE_MANIFEST) {
      const security = deriveRouteSecurity(entry)
      const samplePath = sampleManifestPath(entry.path)
      const normalizedPath = normalizeTenantScopedPath(samplePath)
      const method = entry.method === 'ANY' ? 'GET' : entry.method
      expect(security.authorizationCheckRequired).toBe(
        requiresAuthorizationCheck(normalizedPath, method)
      )
      expect(security.csrfRequired).toBe(requiresCsrf(normalizedPath, method))
      expect(security.corsSurface).toBe(appModule.classifyCorsSurface(samplePath))
      if (!entry.security && (entry.routeClass === 'public' || entry.routeClass === 'tenant-public')) {
        expect(security).toMatchObject({
          authRequired: false,
          csrfRequired: false,
          corsSurface: 'public',
        })
      }
      if (!entry.security && (entry.routeClass === 'admin' || entry.routeClass === 'tenant-admin')) {
        expect(security.authRequired).toBe(true)
        expect(security.corsSurface).toBe('admin')
        expect(security.csrfRequired).toBe(!['GET', 'HEAD', 'OPTIONS'].includes(entry.method))
      }
    }

    for (const signature of EXPECTED_REGISTERED_ROUTE_SIGNATURES) {
      expect(registered).toContain(signature)
    }
  })

  it('benchmarks safe createApp hot paths and flags the 1ms budget without claiming completion', async () => {
    const createApp = await importCreateApp()
    const app = createApp()
    const cases: BenchmarkCase[] = [
      {
        name: 'GET /api/health full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/health'),
      },
      {
        name: 'GET /api root health full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api'),
      },
      {
        name: 'GET /api/me authenticated full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/me'),
        assertResponse: (_response, body) => {
          const parsed = parseJsonBody(body) as { id?: unknown }
          expect(parsed.id).toBe('bench-user-1')
        },
      },
      {
        name: 'GET /api/csrf signed token full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/csrf'),
        assertResponse: (response, body) => {
          const parsed = parseJsonBody(body) as { success?: unknown; data?: { csrfToken?: unknown } }
          expect(parsed.success).toBe(true)
          expect(String(parsed.data?.csrfToken).startsWith('v1.')).toBe(true)
          expect(response.headers.get('set-cookie')).toContain('csrf_token=v1.')
        },
      },
      {
        name: 'GET /api/auth generated mount full app',
        expectedStatus: 404,
        request: () => new Request('http://localhost/api/auth/session'),
      },
      {
        name: 'GET /api/bootstrap/status mocked setup read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/bootstrap/status'),
        assertResponse: (_response, body) => {
          const parsed = parseJsonBody(body) as { needsOnboarding?: unknown }
          expect(parsed.needsOnboarding).toBe(false)
          expect(mockUsersRepository.countAll).toHaveBeenCalled()
        },
      },
      {
        name: 'POST /api/bootstrap/provision-tenant mocked setup mutation full app',
        expectedStatus: 201,
        request: () =>
          new Request('http://localhost/api/bootstrap/provision-tenant', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({}),
          }),
        assertResponse: (_response, body) => {
          expectSuccessEnvelope(body)
          expect(mockEnsureUserHasOnboardingTenant).toHaveBeenCalled()
        },
      },
      {
        name: 'GET /api/public/:collectionSlug mocked cacheable read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/public/articles'),
        assertResponse: (response, body) => {
          expect(response.headers.get('cache-control')).toContain('max-age')
          const parsed = parseJsonBody(body) as { data?: unknown }
          expect(parsed.data).toBeDefined()
        },
      },
      {
        name: 'GET /api/tenants/:tenantSlug/public/:collectionSlug mocked canonical tenant public read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/tenants/acme/public/articles'),
        assertResponse: (response, body) => {
          expect(response.headers.get('cache-control')).toContain('max-age')
          const parsed = parseJsonBody(body) as { data?: unknown }
          expect(parsed.data).toBeDefined()
          expect(mockPublicService.getCollectionList).toHaveBeenCalled()
        },
      },
      {
        name: 'GET /api/tenants/:tenantSlug/public/:collectionSlug/:entryIdOrSlug mocked canonical tenant public read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/tenants/acme/public/articles/entry-1'),
        assertResponse: (response, body) => {
          expect(response.headers.get('cache-control')).toContain('max-age')
          const parsed = parseJsonBody(body) as { id?: unknown }
          expect(parsed.id).toBe('entry-1')
          expect(mockPublicService.getCollectionEntry).toHaveBeenCalled()
        },
      },
      {
        name: 'GET /api/tenants/:tenantSlug/public/singleton/:collectionSlug mocked canonical tenant public read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/tenants/acme/public/singleton/home'),
        assertResponse: (response, body) => {
          expect(response.headers.get('cache-control')).toContain('max-age')
          const parsed = parseJsonBody(body) as { id?: unknown }
          expect(parsed.id).toBe('singleton-1')
          expect(mockPublicService.getSingletonEntry).toHaveBeenCalled()
        },
      },
      {
        name: 'GET /api/admin/entries mocked admin read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/entries?populate=author&depth=1'),
        assertResponse: (_response, body) => {
          expectSuccessEnvelope(body)
          expect(mockEntriesService.findAllWithLocaleAndPopulate).toHaveBeenCalled()
        },
      },
      {
        name: 'GET /api/admin/entries/batch tenant-required error full app',
        expectedStatus: 400,
        request: () => new Request('http://localhost/api/admin/entries/batch?ids=entry-1,entry-2'),
        assertResponse: (_response, body) => {
          expectErrorEnvelope(body)
        },
      },
      {
        name: 'GET /api/admin/entries/:entryId mocked admin read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/entries/entry-1'),
      },
      {
        name: 'POST /api/admin/entries mocked admin create full app',
        expectedStatus: 201,
        request: () =>
          new Request('http://localhost/api/admin/entries', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({ collectionId: 'collection-1', data: { title: 'Hello' } }),
          }),
      },
      {
        name: 'POST /api/admin/entries/:entryId/duplicate mocked admin mutation full app',
        expectedStatus: 201,
        request: () =>
          new Request('http://localhost/api/admin/entries/entry-1/duplicate', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({}),
          }),
      },
      {
        name: 'PUT /api/admin/entries/:entryId mocked admin update full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/entries/entry-1', {
            method: 'PUT',
            headers: jsonHeaders(),
            body: JSON.stringify({ data: { title: 'Updated' } }),
          }),
      },
      {
        name: 'DELETE /api/admin/entries/:entryId mocked admin delete full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/entries/entry-1', {
            method: 'DELETE',
            headers: jsonHeaders(),
          }),
      },
      {
        name: 'GET /api/admin/collections mocked admin read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/collections'),
        assertResponse: (_response, body) => {
          expectSuccessEnvelope(body)
          expect(mockCollectionsService.findAll).toHaveBeenCalled()
        },
      },
      {
        name: 'GET /api/admin/collections/:collectionIdOrSlug mocked admin read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/collections/collection-1'),
      },
      {
        name: 'POST /api/admin/collections mocked admin create full app',
        expectedStatus: 201,
        request: () =>
          new Request('http://localhost/api/admin/collections', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({
              name: 'Articles',
              fields: [{ name: 'title', type: 'text', required: true, localizable: false }],
            }),
          }),
      },
      {
        name: 'PUT /api/admin/collections/:collectionId mocked admin update full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/collections/collection-1', {
            method: 'PUT',
            headers: jsonHeaders(),
            body: JSON.stringify({ name: 'Articles Updated' }),
          }),
      },
      {
        name: 'DELETE /api/admin/collections/:collectionId mocked admin delete full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/collections/collection-1', {
            method: 'DELETE',
            headers: jsonHeaders(),
          }),
      },
      {
        name: 'GET /api/admin/tenants mocked super-admin read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/tenants'),
        assertResponse: (_response, body) => {
          expectSuccessEnvelope(body)
          expect(mockTenantsService.findAll).toHaveBeenCalled()
        },
      },
      {
        name: 'GET /api/tenants/:tenantSlug/admin/collections mocked canonical tenant read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/tenants/acme/admin/collections'),
        assertResponse: (_response, body) => {
          expectSuccessEnvelope(body)
          expect(mockTenantsRepository.findMembershipRole).toHaveBeenCalled()
        },
      },
      {
        name: 'GET /api/tenants/:tenantSlug/admin/users mocked canonical tenant read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/tenants/acme/admin/users'),
        assertResponse: (_response, body) => {
          expectSuccessEnvelope(body)
          expect(mockUsersService.findAdminUsers).toHaveBeenCalled()
        },
      },
      {
        name: 'GET /api/tenants/:tenantSlug/admin/entries/batch mocked tenant read full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/tenants/acme/admin/entries/batch?ids=entry-1,entry-2'),
        assertResponse: (_response, body) => {
          expectSuccessEnvelope(body)
          expect(mockEntriesService.findByIds).toHaveBeenCalled()
        },
      },
      {
        name: 'GET /api/admin/tenants/:tenantSlug mocked super-admin read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/tenants/acme'),
      },
      {
        name: 'POST /api/admin/tenants mocked super-admin create full app',
        expectedStatus: 201,
        request: () =>
          new Request('http://localhost/api/admin/tenants', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({ name: 'Acme', slug: 'acme' }),
          }),
      },
      {
        name: 'PUT /api/admin/tenants/:tenantSlug mocked super-admin update full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/tenants/acme', {
            method: 'PUT',
            headers: jsonHeaders(),
            body: JSON.stringify({ name: 'Acme Updated' }),
          }),
      },
      {
        name: 'DELETE /api/admin/tenants/:tenantSlug mocked super-admin delete full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/tenants/acme', {
            method: 'DELETE',
            headers: jsonHeaders(),
          }),
      },
      {
        name: 'GET /api/admin/tenants/:tenantSlug/users mocked super-admin read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/tenants/acme/users'),
        assertResponse: (_response, body) => {
          expectSuccessEnvelope(body)
          expect(mockTenantsService.findTenantUsersWithDetails).toHaveBeenCalled()
        },
      },
      {
        name: 'POST /api/admin/tenants/:tenantSlug/users mocked super-admin create full app',
        expectedStatus: 201,
        request: () =>
          new Request('http://localhost/api/admin/tenants/acme/users', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({ userId: 'bench-user-1', role: 'member' }),
          }),
      },
      {
        name: 'PUT /api/admin/tenants/:tenantSlug/users/:userId mocked super-admin update full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/tenants/acme/users/bench-user-1', {
            method: 'PUT',
            headers: jsonHeaders(),
            body: JSON.stringify({ role: 'admin' }),
          }),
      },
      {
        name: 'DELETE /api/admin/tenants/:tenantSlug/users/:userId mocked super-admin delete full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/tenants/acme/users/bench-user-1', {
            method: 'DELETE',
            headers: jsonHeaders(),
          }),
      },
      {
        name: 'GET /api/admin/webhooks/signing auth-only read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/webhooks/signing'),
      },
      {
        name: 'GET /api/admin/cache/stats full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/cache/stats'),
      },
      {
        name: 'GET /api/admin/system/stats mocked service full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/system/stats'),
      },
      {
        name: 'GET /api/admin/assets mocked metadata read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/assets'),
      },
      {
        name: 'GET /api/admin/assets/:assetId mocked metadata read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/assets/asset-1'),
      },
      {
        name: 'PUT /api/admin/assets/:assetId mocked metadata update full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/assets/asset-1', {
            method: 'PUT',
            headers: jsonHeaders(),
            body: JSON.stringify({ filename: 'hero-updated.jpg' }),
          }),
      },
      {
        name: 'GET /api/admin/plugins full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/plugins'),
      },
      {
        name: 'PATCH /api/admin/plugins/:pluginName mocked KV full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/plugins/audit-trace', {
            method: 'PATCH',
            headers: jsonHeaders(),
            body: JSON.stringify({ enabled: true }),
          }),
      },
      {
        name: 'GET /api/admin/users mocked admin read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/users'),
      },
      {
        name: 'GET /api/admin/relations/:entryId mocked read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/relations/entry-1'),
      },
      {
        name: 'POST /api/admin/relations/link mocked mutation full app',
        expectedStatus: 201,
        request: () =>
          new Request('http://localhost/api/admin/relations/link', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({
              sourceEntryId: 'entry-1',
              targetEntryId: 'entry-2',
              sourceCollectionId: 'collection-1',
              targetCollectionId: 'collection-2',
              relationType: 'one-to-many',
              fieldName: 'related',
            }),
          }),
      },
      {
        name: 'POST /api/admin/relations/unlink mocked mutation full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/relations/unlink', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({
              sourceEntryId: 'entry-1',
              targetEntryId: 'entry-2',
              fieldName: 'related',
            }),
          }),
      },
      {
        name: 'GET /api/admin/entries/:entryId/versions mocked read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/entries/entry-1/versions'),
      },
      {
        name: 'GET /api/admin/entries/:entryId/versions/:versionId mocked read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/entries/entry-1/versions/version-1'),
      },
      {
        name: 'GET /api/admin/entries/:entryId/versions/:versionId/diff/:targetVersionId mocked read full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/entries/entry-1/versions/version-1/diff/version-2'),
      },
      {
        name: 'POST /api/admin/entries/:entryId/versions/:versionId/rollback mocked mutation full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/entries/entry-1/versions/version-1/rollback', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({}),
          }),
      },
      {
        name: 'POST /api/admin/commands mocked dry-run mutation full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/commands', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({
              type: 'updateEntry',
              payload: { id: 'entry-1', data: {} },
              actor: { userId: 'forged-user', source: 'admin' },
              dryRun: true,
              timestamp: '2026-01-01T00:00:00.000Z',
            }),
          }),
      },
      {
        name: 'GET /api/admin/sync/pull mocked read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/sync/pull?cursor=0&limit=25'),
      },
      {
        name: 'POST /api/admin/sync/push mocked mutation full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/sync/push', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({
              commands: [
                {
                  type: 'updateEntry',
                  payload: { id: 'entry-1', data: {} },
                  actor: { userId: 'bench-user-1', source: 'sync' },
                  timestamp: '2026-01-01T00:00:00.000Z',
                },
              ],
            }),
          }),
      },
      {
        name: 'GET /api/public/:collectionSlug/:entryIdOrSlug mocked cacheable read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/public/articles/entry-1'),
      },
      {
        name: 'GET /api/public/singleton/:collectionSlug mocked cacheable read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/public/singleton/home'),
      },
      {
        name: 'GET /api/admin/webhooks mocked read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/webhooks'),
      },
      {
        name: 'POST /api/admin/webhooks mocked create full app',
        expectedStatus: 201,
        request: () =>
          new Request('http://localhost/api/admin/webhooks', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({ url: 'https://example.com/hook', events: ['entry.created'] }),
          }),
      },
      {
        name: 'GET /api/admin/webhooks/:webhookId mocked read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/webhooks/webhook-1'),
      },
      {
        name: 'PUT /api/admin/webhooks/:webhookId mocked update full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/webhooks/webhook-1', {
            method: 'PUT',
            headers: jsonHeaders(),
            body: JSON.stringify({ enabled: true }),
          }),
      },
      {
        name: 'DELETE /api/admin/webhooks/:webhookId mocked delete full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/webhooks/webhook-1', {
            method: 'DELETE',
            headers: jsonHeaders(),
          }),
      },
      {
        name: 'POST /api/admin/webhooks/:webhookId/test mocked mutation full app',
        expectedStatus: 200,
        request: () =>
          new Request('http://localhost/api/admin/webhooks/webhook-1/test', {
            method: 'POST',
            headers: jsonHeaders(),
            body: JSON.stringify({}),
          }),
      },
      {
        name: 'GET /api/admin/webhooks/:webhookId/deliveries mocked read full app',
        expectedStatus: 200,
        request: () => new Request('http://localhost/api/admin/webhooks/webhook-1/deliveries'),
      },
      {
        name: 'GET /api unknown route envelope full app',
        expectedStatus: 404,
        request: () => new Request('http://localhost/api/unknown-route'),
        assertResponse: (_response, body) => {
          expectErrorEnvelope(body)
        },
      },
    ]

    const includedRouteCount = API_ROUTE_MANIFEST.filter(
      (entry) => entry.benchmarkStatus === 'included'
    ).length
    expect(cases).toHaveLength(includedRouteCount + 1)

    const summaries = []
    for (const testCase of cases) {
      summaries.push(await runBenchmarkCase(app, testCase))
    }

    console.info(
      JSON.stringify({
        contract: 'api-hot-paths-in-process-v1',
        samplesPerCase: summaries[0]?.samples ?? 0,
        budgetMs: 1,
        cases: summaries.map((summary) => ({
          name: summary.name,
          medianMs: summary.medianMs,
          p95Ms: summary.p95Ms,
          overBudget: summary.overBudget,
        })),
        overBudget: summaries.filter((summary) => summary.overBudget).map((summary) => summary.name),
      })
    )

    expect(summaries).toHaveLength(cases.length)
    expect(summaries.every((summary) => Number.isFinite(summary.medianMs))).toBe(true)
    expect(summaries.every((summary) => summary.samples > 0)).toBe(true)
    expect(summaries.filter((summary) => summary.overBudget)).toEqual([])
  })
})
