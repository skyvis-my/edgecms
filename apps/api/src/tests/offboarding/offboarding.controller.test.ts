import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'
import type { Database } from '@/database/db'
import { createOffboardingFixture } from './offboarding-test-seed'

let fixture: ReturnType<typeof createOffboardingFixture>

vi.mock('cloudflare:workers', () => ({
  env: { DB: {}, SUPER_ADMIN_EMAILS: 'root@example.com' },
}))
vi.mock('@/database/db', () => ({ createDb: (): Database => fixture.db }))

const USERS: Record<string, { id: string; email: string; emailVerified: boolean; role: string }> = {
  owner: { id: 'owner-t1', email: 'owner1@example.com', emailVerified: true, role: 'viewer' },
  otherOwner: { id: 'owner-t2', email: 'owner2@example.com', emailVerified: true, role: 'viewer' },
  editor: { id: 'shared-user', email: 'shared@example.com', emailVerified: true, role: 'admin' },
  root: { id: 'root', email: 'root@example.com', emailVerified: true, role: 'viewer' },
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

const { createOffboardingController } = await import(
  `../../offboarding/offboarding.controller?bypass=${Date.now()}`
)
const app = new Elysia().use(createOffboardingController())

function call(user: string, method: string, path: string, body?: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'x-test-user': user, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  )
}

function tenantRows(id: string) {
  return fixture.sqlite.query(`SELECT COUNT(*) n FROM tenants WHERE id = ?`).get(id)
}

beforeEach(() => {
  fixture = createOffboardingFixture()
})

describe('offboardingController export', () => {
  it('streams NDJSON to the tenant owner', async () => {
    const res = await call('owner', 'GET', '/api/admin/tenants/one/export')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const exportId = res.headers.get('x-edgecms-export-id')
    expect(exportId).toBeTruthy()
    const lines = (await res.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string })
    expect(lines[0]?.type).toBe('header')
    expect(lines[lines.length - 1]?.type).toBe('receipt')
  })

  it('denies non-owner members and owners of other tenants', async () => {
    expect((await call('editor', 'GET', '/api/admin/tenants/one/export')).status).toBe(403)
    expect((await call('otherOwner', 'GET', '/api/admin/tenants/one/export')).status).toBe(403)
  })

  it('returns 403 to non-super-admins and 404 to super-admins for unknown tenants', async () => {
    expect((await call('owner', 'GET', '/api/admin/tenants/missing/export')).status).toBe(403)
    expect((await call('root', 'GET', '/api/admin/tenants/missing/export')).status).toBe(404)
  })
})

describe('offboardingController deletion', () => {
  it('is super-admin only, including for the tenant owner', async () => {
    const res = await call('owner', 'POST', '/api/admin/tenants/one/deletion-requests')
    expect(res.status).toBe(403)
    expect(fixture.sqlite.query(`SELECT status FROM tenants WHERE id = 't1'`).get()).toEqual({
      status: 'active',
    })
  })

  it('rejects malformed and mismatched confirmations with 422 and deletes nothing', async () => {
    const requested = await call('root', 'POST', '/api/admin/tenants/one/deletion-requests')
    expect(requested.status).toBe(202)
    const { data } = (await requested.json()) as { data: { id: string } }

    const missingExport = await call('root', 'POST', `/api/admin/tenant-deletions/${data.id}/confirm`, {
      tenantSlug: 'one',
    })
    expect(missingExport.status).toBe(422)

    const exportRes = await call('root', 'GET', '/api/admin/tenants/one/export')
    await exportRes.text()
    const exportId = exportRes.headers.get('x-edgecms-export-id')

    const wrongSlug = await call('root', 'POST', `/api/admin/tenant-deletions/${data.id}/confirm`, {
      tenantSlug: 'ONE',
      exportId,
    })
    expect(wrongSlug.status).toBe(422)
    expect(tenantRows('t1')).toEqual({ n: 1 })

    const ok = await call('root', 'POST', `/api/admin/tenant-deletions/${data.id}/confirm`, {
      tenantSlug: 'one',
      exportId,
    })
    expect(ok.status).toBe(200)
    expect(tenantRows('t1')).toEqual({ n: 0 })
    expect(tenantRows('t2')).toEqual({ n: 1 })
  })
})
