import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'
import type { Database } from '@/database/db'
import { createOffboardingFixture, tenantRowCounts } from '../offboarding/offboarding-test-seed'

/**
 * HS-09 follow-up: the legacy `DELETE /api/admin/tenants/:tenantSlug` used to
 * drop the tenant row at once, without a typed confirmation or an export, and
 * left rows in tables that do not cascade from `tenants`. It must now refuse
 * and point the caller at the confirmed offboarding flow.
 */

let fixture: ReturnType<typeof createOffboardingFixture>

vi.mock('cloudflare:workers', () => ({
  env: { DB: {}, CACHE: {}, MEDIA: {}, SUPER_ADMIN_EMAILS: 'root@example.com' },
}))
vi.mock('@/database/db', () => ({ createDb: (): Database => fixture.db }))

const ROOT = { id: 'root', email: 'root@example.com', emailVerified: true, role: 'viewer' }

vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia({ name: 'test-auth' }).macro({
    auth: {
      derive() {
        return { user: ROOT }
      },
    },
  }),
}))

const { createTenantsController } = await import(
  `../../tenants/tenants.controller?bypass=${Date.now()}`
)
const app = new Elysia().use(createTenantsController())

function tenantRow(id: string) {
  return fixture.sqlite.query(`SELECT status FROM tenants WHERE id = ?`).get(id) as
    | { status: string }
    | null
}

beforeEach(() => {
  fixture = createOffboardingFixture()
})

describe('legacy DELETE /api/admin/tenants/:tenantSlug', () => {
  it('never deletes the tenant directly, so no tenant-scoped rows are orphaned', async () => {
    const before = await tenantRowCounts(fixture.db, 't1')
    const res = await app.handle(
      new Request('http://localhost/api/admin/tenants/one', { method: 'DELETE' })
    )

    // Either the tenant is gone with all its rows, or nothing was deleted.
    // The old route deleted the tenant row and left the rest behind.
    expect(tenantRow('t1')).toEqual({ status: 'active' })
    expect(await tenantRowCounts(fixture.db, 't1')).toEqual(before)
    expect(res.status).toBe(409)
  })

  it('returns a typed error that points at the offboarding endpoints', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/admin/tenants/one', { method: 'DELETE' })
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as {
      success: boolean
      error: { code: string; details: { offboarding: Record<string, string> } }
    }
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('TENANT_OFFBOARDING_REQUIRED')
    expect(body.error.details.offboarding).toEqual({
      export: 'GET /api/admin/tenants/one/export',
      request: 'POST /api/admin/tenants/one/deletion-requests',
      status: 'GET /api/admin/tenant-deletions/:jobId',
      confirm: 'POST /api/admin/tenant-deletions/:jobId/confirm',
      cancel: 'POST /api/admin/tenant-deletions/:jobId/cancel',
    })
  })

  it('still returns 404 for unknown tenants', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/admin/tenants/missing', { method: 'DELETE' })
    )
    expect(res.status).toBe(404)
  })

  it('leaves other tenants untouched', async () => {
    const before = await tenantRowCounts(fixture.db, 't2')
    await app.handle(new Request('http://localhost/api/admin/tenants/one', { method: 'DELETE' }))
    expect(await tenantRowCounts(fixture.db, 't2')).toEqual(before)
  })
})
