import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const { d1, sqlite } = createSqliteD1()
const mockEnv: Record<string, unknown> = {
  DB: d1,
  BETTER_AUTH_SECRET: 'test-better-auth-secret-at-least-32',
  SUPER_ADMIN_EMAILS: 'root@example.com',
}
mock.module('cloudflare:workers', () => ({ env: mockEnv }))

const mockGetSession = vi.fn(async (): Promise<unknown> => null)
const fakeAuth = { handler: () => new Response(null, { status: 404 }), api: { getSession: mockGetSession } }
mock.module('@/auth/auth', () => ({
  createAuth: () => fakeAuth,
  createAuthForEnv: () => fakeAuth,
}))

const { configureAuthPolicies, __resetAuthPoliciesForTests } = await import('@/auth/auth-policies')
const { invitesController } = await import('@/invites/invites.controller')

function sessionFor(email: string) {
  const id = `u-${email}`
  sqlite
    .query(
      `insert or ignore into user (id, name, email, role, emailVerified, createdAt, updatedAt)
       values (?, ?, ?, 'viewer', 1, 0, 0)`
    )
    .run(id, email, email)
  return {
    user: { id, name: email, email, emailVerified: true, role: 'viewer' },
    session: { id: `s-${email}` },
  }
}

async function call(method: string, path: string, body?: unknown) {
  const response = await invitesController.handle(
    new Request(`http://localhost/api/admin/invites${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
  )
  return { status: response.status, json: (await response.json().catch(() => null)) as any }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(null)
  __resetAuthPoliciesForTests()
  sqlite.exec('delete from signup_invites')
})

describe('invites controller', () => {
  it('requires authentication', async () => {
    expect((await call('GET', '/')).status).toBe(401)
  })

  it('requires a super-admin', async () => {
    mockGetSession.mockResolvedValue(sessionFor('editor@example.com'))
    expect((await call('POST', '/', { email: 'new@example.com' })).status).toBe(403)
  })

  it('creates, lists and revokes invites without exposing token hashes', async () => {
    mockGetSession.mockResolvedValue(sessionFor('root@example.com'))
    const created = await call('POST', '/', { email: 'New@Example.com', expiresInHours: 2 })
    expect(created.status).toBe(201)
    expect(created.json.data.token).toEqual(expect.any(String))
    expect(created.json.data.signUpPath).toBe(
      `/sign-up?invite=${encodeURIComponent(created.json.data.token)}`
    )
    expect(created.json.data.invite).toMatchObject({ email: 'new@example.com', status: 'pending' })
    expect(created.json.data.emailed).toBe(false)

    const listed = await call('GET', '/')
    expect(listed.json.data).toHaveLength(1)
    expect(JSON.stringify(listed.json)).not.toContain('tokenHash')
    expect(JSON.stringify(listed.json)).not.toContain(created.json.data.token)

    const id = created.json.data.invite.id
    expect((await call('DELETE', `/${id}`)).status).toBe(200)
    expect((await call('DELETE', `/${id}`)).status).toBe(409)
    expect((await call('GET', '/')).json.data[0].status).toBe('revoked')
  })

  it('rejects an unknown tenant', async () => {
    mockGetSession.mockResolvedValue(sessionFor('root@example.com'))
    const res = await call('POST', '/', { email: 'new@example.com', tenantSlug: 'nope' })
    expect(res.status).toBe(404)
  })

  it('emails the invite link when a sender is configured', async () => {
    const sent: { to: string; text: string }[] = []
    configureAuthPolicies({ emailSender: { send: async (m) => void sent.push(m) } })
    mockGetSession.mockResolvedValue(sessionFor('root@example.com'))
    const created = await call('POST', '/', { email: 'mail@example.com' })
    expect(created.json.data.emailed).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('mail@example.com')
    expect(sent[0]!.text).toContain(`http://localhost${created.json.data.signUpPath}`)
  })
})
