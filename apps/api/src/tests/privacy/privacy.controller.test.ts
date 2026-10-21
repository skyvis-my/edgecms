import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'
import type { Database } from '@/database/db'
import { createPrivacyFixture } from './privacy-test-seed'

let fixture: Awaited<ReturnType<typeof createPrivacyFixture>>

vi.mock('cloudflare:workers', () => ({
  env: { DB: {}, SUPER_ADMIN_EMAILS: 'root@example.com' },
}))
vi.mock('@/database/db', () => ({ createDb: (): Database => fixture.db }))

const USERS: Record<string, { id: string; email: string; emailVerified: boolean; role: string }> = {
  alice: { id: 'alice', email: 'alice@example.com', emailVerified: true, role: 'editor' },
  bob: { id: 'bob', email: 'bob@example.com', emailVerified: true, role: 'admin' },
  root: { id: 'root', email: 'root@example.com', emailVerified: true, role: 'viewer' },
  'root-unverified': { id: 'root-2', email: 'root@example.com', emailVerified: false, role: 'viewer' },
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

const { privacyController } = await import(`../../privacy/privacy.controller?bypass=${Date.now()}`)
const app = new Elysia().use(privacyController)

function call(user: string, method: string, path: string, body?: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'x-test-user': user, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  )
}

beforeEach(async () => {
  fixture = await createPrivacyFixture()
})

describe('privacyController', () => {
  it('exports the signed-in user only', async () => {
    const res = await call('alice', 'GET', '/api/me/data-export')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { data: { user: { id: string } } }
    expect(body.data.user.id).toBe('alice')
  })

  it('denies non-super-admins, including global admins, on another user', async () => {
    expect((await call('bob', 'GET', '/api/admin/users/alice/data-export')).status).toBe(403)
    expect(
      (await call('bob', 'POST', '/api/admin/users/alice/data-deletion', { confirm: 'DELETE' }))
        .status
    ).toBe(403)
    expect(fixture.sqlite.query(`SELECT COUNT(*) n FROM user WHERE id = 'alice'`).get()).toEqual({
      n: 1,
    })
  })

  it('denies an unverified SUPER_ADMIN_EMAILS address', async () => {
    expect((await call('root-unverified', 'GET', '/api/admin/users/alice/data-export')).status).toBe(403)
  })

  it('lets super-admins export and delete any user', async () => {
    expect((await call('root', 'GET', '/api/admin/users/alice/data-export')).status).toBe(200)
    const res = await call('root', 'POST', '/api/admin/users/alice/data-deletion', {
      confirm: 'DELETE',
    })
    expect(res.status).toBe(200)
    expect(fixture.sqlite.query(`SELECT COUNT(*) n FROM user WHERE id = 'alice'`).get()).toEqual({
      n: 0,
    })
  })

  it('requires the explicit confirmation for self-deletion and clears session cookies', async () => {
    expect((await call('alice', 'POST', '/api/me/data-deletion', {})).status).toBe(422)
    expect(
      (await call('alice', 'POST', '/api/me/data-deletion', { confirm: 'yes' })).status
    ).toBe(422)

    const res = await call('alice', 'POST', '/api/me/data-deletion', { confirm: 'DELETE' })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('better-auth.session_token=; Path=/; Max-Age=0')
    const body = (await res.json()) as { data: { pseudonym: string; receipt: { seq: number } } }
    expect(body.data.pseudonym).toStartWith('deleted-user:')
    expect(body.data.receipt.seq).toBeGreaterThan(0)
  })

  it('returns 409 when the user is the only owner of a tenant', async () => {
    fixture.sqlite.run(`UPDATE tenant_users SET role = 'member' WHERE userId = 'bob'`)
    const res = await call('alice', 'POST', '/api/me/data-deletion', { confirm: 'DELETE' })
    expect(res.status).toBe(409)
  })
})
