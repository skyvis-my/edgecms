import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { Database as BunSqlite } from 'bun:sqlite'
import { drizzle as drizzleBunSqlite } from 'drizzle-orm/bun-sqlite'
import { Elysia } from 'elysia'
import type { Database } from '@/database/db'
import { createMigratedTestDb } from '../audit/audit-test-db'

let fixture: ReturnType<typeof createMigratedTestDb>

const mockExecuteGeneratedCommands = vi.fn()
const mockCreateBatch = vi.fn()
const mockProcessMcpMessage = vi.fn()

vi.mock('cloudflare:workers', () => ({
  env: {
    DB: {},
    SUPER_ADMIN_EMAILS: 'root@example.com',
    MCP_API_KEY: 'mcp-test-key',
    ENABLE_AI_IMPORT_REVIEW: 'true',
  },
}))
vi.mock('@/database/db', () => ({ createDb: (): Database => fixture.db }))

const USERS: Record<string, { id: string; email: string; emailVerified: boolean; role: string }> = {
  owner: { id: 'owner', email: 'owner@example.com', emailVerified: true, role: 'viewer' },
  member: { id: 'member', email: 'member@example.com', emailVerified: true, role: 'viewer' },
  outsider: { id: 'outsider', email: 'outsider@example.com', emailVerified: true, role: 'viewer' },
  root: { id: 'root', email: 'root@example.com', emailVerified: true, role: 'viewer' },
  'root-unverified': { id: 'root-2', email: 'root@example.com', emailVerified: false, role: 'viewer' },
}

vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia({ name: 'test-auth' }).macro({
    auth: {
      derive({ request }: { request: Request }) {
        return { user: USERS[request.headers.get('x-test-user') ?? 'owner'] }
      },
    },
  }),
}))
vi.mock('../../ai/ai.service', () => ({
  executeGeneratedCommands: mockExecuteGeneratedCommands,
  runAiWorkflow: vi.fn(),
}))
vi.mock('../../ai/imports.service', () => ({
  aiImportService: { createBatch: mockCreateBatch },
}))
vi.mock('../../mcp/mcp-server', () => ({ processMcpMessage: mockProcessMcpMessage }))

const bust = Date.now()
const { aiController } = await import(`../../ai/ai.controller?bypass=${bust}`)
const { aiSettingsController } = await import(`../../ai/ai-settings.controller?bypass=${bust}`)
const { mcpController } = await import(`../../mcp/mcp.controller?bypass=${bust}`)
const { isTenantAiEnabled } = await import('@/ai/ai-access')
const { tenantsRepository } = await import('@/tenants/tenants.repository')
const { auditRepository } = await import('@/audit/audit.repository')

function tenantCtx(id: string) {
  return {
    tenant: {
      id,
      slug: id,
      name: id,
      status: 'active',
      mediaUploadMaxBytes: 1,
      mediaUploadMaxDimension: 1,
      mediaAllowedMimeTypes: [],
    },
    resources: { mode: 'shared' as const },
  }
}

function appFor(tenantId: string) {
  return new Elysia()
    .state('tenant', tenantCtx(tenantId))
    .use(aiController)
    .use(aiSettingsController)
    .use(mcpController)
}

function call(tenantId: string, method: string, path: string, body?: unknown, user = 'owner') {
  return appFor(tenantId).handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        'x-test-user': user,
        'x-edgecms-api-key': 'mcp-test-key',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  )
}

const NOW = '2026-01-01T00:00:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
  fixture = createMigratedTestDb()
  fixture.sqlite.exec(`
    INSERT INTO tenants (id, slug, name, createdAt, updatedAt, aiEnabled) VALUES
      ('off', 'off', 'Off', '${NOW}', '${NOW}', 0),
      ('on', 'on', 'On', '${NOW}', '${NOW}', 1);
    INSERT INTO tenant_users (tenantId, userId, role, createdAt) VALUES
      ('off', 'owner', 'owner', '${NOW}'),
      ('off', 'member', 'member', '${NOW}'),
      ('on', 'owner', 'owner', '${NOW}');
  `)
  mockExecuteGeneratedCommands.mockResolvedValue({ commands: [], results: [] })
  mockCreateBatch.mockResolvedValue({ id: 'batch-1' })
  mockProcessMcpMessage.mockResolvedValue({ jsonrpc: '2.0', id: 1, result: {} })
})

describe('migration 0033 default (HS-14)', () => {
  it('keeps existing tenants enabled and creates new tenants disabled', async () => {
    const sqlite = new BunSqlite(':memory:')
    const dir = new URL('../../../drizzle/migrations/', import.meta.url)
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    const before = files.filter((f) => f < '0033')
    for (const file of before) sqlite.exec(readFileSync(new URL(file, dir), 'utf8'))
    sqlite.exec(
      `INSERT INTO tenants (id, slug, name, createdAt, updatedAt) VALUES ('old', 'old', 'Old', '${NOW}', '${NOW}')`
    )
    for (const file of files.filter((f) => f >= '0033')) {
      sqlite.exec(readFileSync(new URL(file, dir), 'utf8'))
    }
    expect(sqlite.query(`SELECT aiEnabled FROM tenants WHERE id = 'old'`).get()).toEqual({
      aiEnabled: 1,
    })

    const migratedDb = drizzleBunSqlite(sqlite) as unknown as Database
    const created = await tenantsRepository.create(migratedDb, {
      id: 'new',
      slug: 'new',
      name: 'New',
      localeCatalog: ['en'],
      mediaAllowedMimeTypes: [],
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(created.aiEnabled).toBe(false)
  })
})

describe('isTenantAiEnabled', () => {
  it('reads the tenant switch, fails closed for unknown tenants, passes global scope', async () => {
    const db = fixture.db
    expect(await isTenantAiEnabled({ db, tenantId: 'on' })).toBe(true)
    expect(await isTenantAiEnabled({ db, tenantId: 'off' })).toBe(false)
    expect(await isTenantAiEnabled({ db, tenantId: 'missing' })).toBe(false)
    expect(await isTenantAiEnabled({ db, tenantId: undefined })).toBe(true)
    expect(await isTenantAiEnabled({ tenantId: 'on' })).toBe(false)
  })
})

describe('AI paths with the switch off', () => {
  it('refuses AI commands before any provider call', async () => {
    const res = await call('off', 'POST', '/api/admin/ai/command', { prompt: 'rewrite titles' })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('AI_DISABLED')
    expect(mockExecuteGeneratedCommands).not.toHaveBeenCalled()
  })

  it('refuses AI import routes', async () => {
    const res = await call('off', 'POST', '/api/admin/ai/import-batches', { intent: 'import' })
    expect(res.status).toBe(403)
    expect(mockCreateBatch).not.toHaveBeenCalled()
  })

  it('refuses MCP requests for the tenant', async () => {
    const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    const res = await call('off', 'POST', '/api/mcp', rpc)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: number; data: { code: string } } }
    expect(body.error).toMatchObject({ code: -32003, data: { code: 'AI_DISABLED' } })
    expect(mockProcessMcpMessage).not.toHaveBeenCalled()
  })

  it('serves the same routes once the switch is on', async () => {
    expect((await call('on', 'POST', '/api/admin/ai/command', { prompt: 'x', dryRun: true })).status).toBe(200)
    expect(mockExecuteGeneratedCommands).toHaveBeenCalledTimes(1)
    expect(
      (await call('on', 'POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status
    ).toBe(200)
  })
})

describe('tenant AI settings endpoint', () => {
  it('shows state and providers to members, with canManage only for owners/admins', async () => {
    const res = await call('off', 'GET', '/api/admin/settings/ai', undefined, 'member')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { aiEnabled: boolean; canManage: boolean; providers: { operator: string }[] }
    }
    expect(body.data.aiEnabled).toBe(false)
    expect(body.data.canManage).toBe(false)
    expect(body.data.providers.map((p) => p.operator)).toEqual([
      'Alibaba Cloud',
      'Google',
      'Cloudflare',
    ])
  })

  it('denies outsiders and members from changing it', async () => {
    const outsider = await call('off', 'GET', '/api/admin/settings/ai', undefined, 'outsider')
    expect(outsider.status).toBe(403)
    const res = await call('off', 'PUT', '/api/admin/settings/ai', { aiEnabled: true }, 'member')
    expect(res.status).toBe(403)
    expect(await isTenantAiEnabled({ db: fixture.db, tenantId: 'off' })).toBe(false)
  })

  it('lets an owner enable it, records an audit event, and unblocks AI', async () => {
    const res = await call('off', 'PUT', '/api/admin/settings/ai', { aiEnabled: true })
    expect(res.status).toBe(200)
    expect(await isTenantAiEnabled({ db: fixture.db, tenantId: 'off' })).toBe(true)

    const events = await auditRepository.listPage(fixture.db, 'off', 0, 10)
    expect(events.map((e) => [e.action, e.actorId])).toEqual([['settings.ai_enabled', 'owner']])
    expect(events[0]!.metadata).toMatchObject({ previous: false })

    expect((await call('off', 'POST', '/api/admin/ai/command', { prompt: 'x', dryRun: true })).status).toBe(200)
  })

  it('does not treat an unverified SUPER_ADMIN_EMAILS address as super-admin', async () => {
    const res = await call('on', 'PUT', '/api/admin/settings/ai', { aiEnabled: false }, 'root-unverified')
    expect(res.status).toBe(403)
    expect(await isTenantAiEnabled({ db: fixture.db, tenantId: 'on' })).toBe(true)
  })

  it('lets super-admins change any tenant', async () => {
    const res = await call('on', 'PUT', '/api/admin/settings/ai', { aiEnabled: false }, 'root')
    expect(res.status).toBe(200)
    expect(await isTenantAiEnabled({ db: fixture.db, tenantId: 'on' })).toBe(false)
  })
})
