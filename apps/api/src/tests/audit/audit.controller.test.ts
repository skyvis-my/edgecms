import { beforeAll, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'
import { createAuditTestDb } from './audit-test-db'

const { db, sqlite } = createAuditTestDb()

vi.mock('cloudflare:workers', () => ({
  env: { DB: {}, SUPER_ADMIN_EMAILS: 'root@example.com' },
}))

vi.mock('@/database/db', () => ({
  createDb: () => db,
}))

const USERS: Record<string, { id: string; email: string; role: string }> = {
  'admin-a': { id: 'admin-a', email: 'a@example.com', role: 'viewer' },
  'member-a': { id: 'member-a', email: 'm@example.com', role: 'viewer' },
  root: { id: 'root', email: 'root@example.com', role: 'viewer' },
}

vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia({ name: 'test-auth' }).macro({
    auth: {
      derive({ request }: { request: Request }) {
        return { user: USERS[request.headers.get('x-test-user') ?? ''] }
      },
    },
  }),
}))

const { auditController } = await import(`../../audit/audit.controller?bypass=${Date.now()}`)
const { auditService } = await import('@/audit/audit.service')

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

const appA = new Elysia().state('tenant', tenantCtx('tenant-a')).use(auditController)
const appB = new Elysia().state('tenant', tenantCtx('tenant-b')).use(auditController)
const appGlobal = new Elysia().use(auditController)

function get(app: typeof appA, path: string, user?: string) {
  return app.handle(
    new Request(`http://localhost${path}`, { headers: user ? { 'x-test-user': user } : {} })
  )
}

beforeAll(async () => {
  const now = new Date().toISOString()
  sqlite.run(`INSERT INTO tenant_users VALUES ('tenant-a','admin-a','admin','${now}')`)
  sqlite.run(`INSERT INTO tenant_users VALUES ('tenant-a','member-a','member','${now}')`)
  for (const scope of ['tenant-a', 'tenant-b', 'global']) {
    await auditService.append(db, {
      scope,
      category: 'rbac',
      action: 'admin.roles.post',
      outcome: 'success',
      actorId: 'someone',
      actorSource: 'user',
      metadata: { marker: scope, token: 'tok_live_123' },
    })
  }
})

describe('auditController', () => {
  it('exports only the caller tenant chain, with secrets redacted', async () => {
    const res = await get(appA, '/api/admin/audit/export', 'admin-a')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as {
      data: { scope: string; events: { scope: string; metadata: Record<string, unknown> }[]; head: unknown }
    }
    expect(body.data.scope).toBe('tenant-a')
    expect(body.data.events.map((e) => e.metadata.marker)).toEqual(['tenant-a'])
    expect(body.data.events[0]!.metadata.token).toBe('[redacted]')
    expect(JSON.stringify(body)).not.toContain('tok_live_123')
    expect(body.data.head).toMatchObject({ seq: 1 })
  })

  it('denies a tenant-a admin on tenant-b (cross-tenant isolation)', async () => {
    const res = await get(appB, '/api/admin/audit/export', 'admin-a')
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).not.toContain('tenant-b')
  })

  it('denies tenant members without owner/admin role', async () => {
    expect((await get(appA, '/api/admin/audit/export', 'member-a')).status).toBe(403)
    expect((await get(appA, '/api/admin/audit/verify', 'member-a')).status).toBe(403)
  })

  it('rejects unauthenticated callers', async () => {
    expect((await get(appA, '/api/admin/audit/export')).status).toBe(401)
  })

  it('serves the global chain to super-admins only', async () => {
    expect((await get(appGlobal, '/api/admin/audit/export', 'admin-a')).status).toBe(403)
    const res = await get(appGlobal, '/api/admin/audit/export', 'root')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { events: { metadata: { marker: string } }[] } }
    expect(body.data.events.map((e) => e.metadata.marker)).toEqual(['global'])
  })

  it('lets super-admins read a tenant chain', async () => {
    expect((await get(appB, '/api/admin/audit/export', 'root')).status).toBe(200)
  })

  it('verifies the tenant chain and reports tampering', async () => {
    const ok = await get(appA, '/api/admin/audit/verify', 'admin-a')
    expect(((await ok.json()) as { data: { valid: boolean } }).data.valid).toBe(true)

    sqlite.run(`UPDATE audit_events SET outcome = 'failure' WHERE scope = 'tenant-a'`)
    const tampered = await get(appA, '/api/admin/audit/verify', 'admin-a')
    const body = (await tampered.json()) as { data: { valid: boolean; failure: { reason: string } } }
    expect(body.data.valid).toBe(false)
    expect(body.data.failure.reason).toBe('hash_mismatch')
  })

  it('pages exports with an after cursor', async () => {
    const res = await get(appGlobal, '/api/admin/audit/export?after=1&limit=10', 'root')
    const body = (await res.json()) as { data: { events: unknown[]; nextCursor: number | null } }
    expect(body.data.events).toHaveLength(0)
    expect(body.data.nextCursor).toBeNull()
  })
})
