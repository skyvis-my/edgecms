import { describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'
import { createAuditTestDb } from './audit-test-db'

const { db } = createAuditTestDb()

vi.mock('cloudflare:workers', () => ({ env: { DB: {} } }))
vi.mock('@/database/db', () => ({ createDb: () => db }))
vi.mock('@/auth/rbac', () => ({
  resolveActorSessionDetails: async () => ({ actorId: 'admin-1' }),
}))
vi.mock('@/tenants/tenants.service', () => ({
  tenantsService: {
    findByIdOrSlug: async (_db: unknown, slug: string) =>
      slug === 'missing'
        ? { success: false, error: { code: 'NOT_FOUND', message: 'nope' } }
        : { success: true, data: { id: `id-${slug}`, slug } },
  },
}))

const { auditTrailPlugin, classifyAdminAuditRequest, extractRouteParams } = await import(
  `../../audit/audit-trail.plugin?bypass=${Date.now()}`
)
const { auditRepository } = await import('@/audit/audit.repository')
const { auditService } = await import('@/audit/audit.service')
const {
  classifyAuthAuditAction,
  cookieHeaderFromResponse,
  recordAuthAuditEvent,
  recordCommandAuditEvent,
} = await import('@/audit/audit-recorders')

const app = new Elysia()
  .use(auditTrailPlugin)
  .group('/api/tenants/:tenantSlug', (tenant) =>
    tenant
      .post('/api/admin/roles', ({ set }: { set: { status?: unknown } }) => {
        set.status = 201
        return { ok: true }
      })
      .delete('/api/admin/roles/:roleId', ({ set }: { set: { status?: unknown } }) => {
        set.status = 403
        return { ok: false }
      })
      .post('/api/admin/commands', () => ({ ok: true }))
  )
  .put('/api/admin/tenants/:tenantSlug/users/:userId', () => ({ ok: true }))
  .post('/api/admin/tenants', () => {
    throw new Error('boom')
  })

function call(method: string, path: string) {
  return app.handle(new Request(`http://localhost${path}`, { method }))
}

describe('classifyAdminAuditRequest', () => {
  it('audits role, membership, tenant and settings mutations', () => {
    expect(classifyAdminAuditRequest('/api/tenants/acme/api/admin/roles', 'POST')).toEqual({
      scope: { tenantSlug: 'acme' },
      category: 'rbac',
      area: 'roles',
    })
    expect(classifyAdminAuditRequest('/api/admin/tenants/acme/users/u1', 'PUT')?.category).toBe('rbac')
    expect(classifyAdminAuditRequest('/api/admin/tenants', 'POST')?.category).toBe('super_admin')
    expect(classifyAdminAuditRequest('/api/tenants/acme/api/admin/webhooks', 'POST')?.category).toBe(
      'settings'
    )
  })

  it('audits audit-log reads but not other reads or content routes', () => {
    expect(classifyAdminAuditRequest('/api/admin/audit/export', 'GET')?.category).toBe('audit')
    expect(classifyAdminAuditRequest('/api/admin/roles', 'GET')).toBeNull()
    expect(classifyAdminAuditRequest('/api/tenants/acme/api/admin/commands', 'POST')).toBeNull()
    expect(classifyAdminAuditRequest('/api/public/x', 'POST')).toBeNull()
  })

  it('extracts params from a route template', () => {
    expect(extractRouteParams('/api/admin/tenants/:tenantSlug/users/:userId', '/api/admin/tenants/acme/users/u%201')).toEqual({
      tenantSlug: 'acme',
      userId: 'u 1',
    })
  })
})

describe('auditTrailPlugin', () => {
  it('records role changes in the tenant chain and denied attempts as failures', async () => {
    await call('POST', '/api/tenants/acme/api/admin/roles')
    await call('DELETE', '/api/tenants/acme/api/admin/roles/r1')
    await call('POST', '/api/tenants/acme/api/admin/commands')

    const events = await auditRepository.listPage(db, 'id-acme', 0, 10)
    expect(events.map((e) => [e.action, e.outcome, e.actorId])).toEqual([
      ['admin.roles.post', 'success', 'admin-1'],
      ['admin.roles.delete', 'failure', 'admin-1'],
    ])
    expect(events[1]!.metadata).toMatchObject({ roleId: 'r1', status: 403 })
  })

  it('records super-admin membership changes globally with the user as target, not metadata', async () => {
    await call('PUT', '/api/admin/tenants/acme/users/user-9')
    await call('POST', '/api/admin/tenants')

    const events = await auditRepository.listPage(db, 'global', 0, 10)
    const membership = events.find((e) => e.action === 'admin.tenants.put')!
    expect(membership.category).toBe('rbac')
    expect(membership.targetType).toBe('user')
    expect(membership.targetId).toBe('user-9')
    expect(JSON.stringify(membership.metadata)).not.toContain('user-9')

    const failed = events.find((e) => e.action === 'admin.tenants.post')!
    expect(failed).toMatchObject({ category: 'super_admin', outcome: 'failure' })
    expect((await auditService.verify(db, 'global')).valid).toBe(true)
  })
})

describe('auth audit recorders', () => {
  it('classifies Better Auth endpoints', () => {
    expect(classifyAuthAuditAction('/api/auth/sign-in/email', 'POST')).toBe('auth.sign_in')
    expect(classifyAuthAuditAction('/api/auth/callback/google', 'GET')).toBe('auth.sign_in')
    expect(classifyAuthAuditAction('/api/auth/sign-up/email', 'POST')).toBe('auth.sign_up')
    expect(classifyAuthAuditAction('/api/auth/sign-out', 'POST')).toBe('auth.sign_out')
    expect(classifyAuthAuditAction('/api/auth/get-session', 'GET')).toBeNull()
    expect(classifyAuthAuditAction('/api/auth/sign-in/social', 'POST')).toBeNull()
  })

  it('builds a cookie header from Set-Cookie values', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'better-auth.session_token=abc.def; Path=/; HttpOnly')
    headers.append('set-cookie', 'cleared=; Max-Age=0')
    expect(cookieHeaderFromResponse(new Response(null, { headers }))).toBe(
      'better-auth.session_token=abc.def'
    )
  })

  it('records sign-in success with the user id only and failures without identity', async () => {
    const { db: authDb } = createAuditTestDb()
    await recordAuthAuditEvent({
      db: authDb,
      action: 'auth.sign_in',
      pathname: '/api/auth/sign-in/email',
      response: new Response('{}', { status: 200 }),
      userId: 'user-1',
    })
    await recordAuthAuditEvent({
      db: authDb,
      action: 'auth.sign_in',
      pathname: '/api/auth/sign-in/email',
      response: new Response('{}', { status: 401 }),
      userId: null,
    })
    await recordAuthAuditEvent({
      db: authDb,
      action: 'auth.sign_in',
      pathname: '/api/auth/callback/google',
      response: new Response(null, { status: 302, headers: { location: '/login?error=denied' } }),
      userId: 'user-1',
    })
    const events = await auditRepository.listPage(authDb, 'global', 0, 10)
    expect(events.map((e) => [e.outcome, e.actorId])).toEqual([
      ['success', 'user-1'],
      ['failure', null],
      ['failure', null],
    ])
    expect(events[2]!.metadata).toMatchObject({ provider: 'google' })
  })

  it('records executed commands in the tenant chain and skips dry runs', async () => {
    const { db: cmdDb } = createAuditTestDb()
    const envelope = {
      type: 'updateEntry',
      payload: { entryId: 'e1', data: { password: 'x' } },
      actor: { userId: 'editor-1', source: 'user' },
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    for (const status of ['success', 'failed', 'dry_run'] as const) {
      await recordCommandAuditEvent({
        db: cmdDb,
        tenantScope: 'tenant-a',
        envelope: envelope as never,
        result: {
          commandId: `c-${status}`,
          type: 'updateEntry',
          status,
          executedAt: '2026-01-01T00:00:00.000Z',
          ...(status === 'failed' ? { error: { code: 'VERSION_CONFLICT', message: 'x' } } : {}),
        } as never,
      })
    }
    const events = await auditRepository.listPage(cmdDb, 'tenant-a', 0, 10)
    expect(events.map((e) => [e.outcome, e.targetId])).toEqual([
      ['success', 'c-success'],
      ['failure', 'c-failed'],
    ])
    expect(events[1]!.metadata).toEqual({
      commandType: 'updateEntry',
      entryId: 'e1',
      errorCode: 'VERSION_CONFLICT',
    })
  })
})
