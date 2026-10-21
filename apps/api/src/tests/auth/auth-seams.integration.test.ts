import { beforeEach, describe, expect, it } from 'bun:test'
import { __resetAuthCacheForTests, createAuth } from '@/auth/auth'
import type { AuthEmailMessage, AuthPolicies } from '@/auth/auth-policies'
import { enforceSignupPolicy } from '@/auth/signup-policy'
import { createDb } from '@/database/db'
import { invitesService } from '@/invites/invites.service'
import { CookieJar, TEST_ORIGIN, callAuth, totpFromUri } from '../helpers/auth-client'
import { createSqliteD1 } from '../helpers/sqlite-d1'

const SECRET = 'integration-test-secret-at-least-32-characters'
const PASSWORD = 'correct-horse-battery'

function setup(policies: Partial<AuthPolicies> = {}) {
  const { d1, sqlite } = createSqliteD1()
  const auth = createAuth(d1, {
    secret: SECRET,
    baseURL: TEST_ORIGIN,
    policies: { signupPolicy: 'open', requireMfaForSuperAdmins: false, ...policies },
  })
  return { auth, sqlite, db: createDb(d1) }
}

type Harness = ReturnType<typeof setup>

function signUp(
  h: Harness,
  email: string,
  extra: Record<string, unknown> = {},
  jar = new CookieJar()
) {
  return callAuth(h.auth, '/sign-up/email', {
    body: { name: email.split('@')[0], email, password: PASSWORD, ...extra },
    jar,
  })
}

function signIn(h: Harness, email: string, jar = new CookieJar()) {
  return callAuth(h.auth, '/sign-in/email', { body: { email, password: PASSWORD }, jar })
}

async function getSession(h: Harness, jar: CookieJar) {
  return (await callAuth(h.auth, '/get-session', { jar })).json as {
    user: { id: string; email: string; twoFactorEnabled?: boolean }
    session: { mfaVerified?: boolean }
  } | null
}

function userCount(h: Harness): number {
  return (h.sqlite.query('select count(*) as c from user').get() as { c: number }).c
}

async function seedTenant(h: Harness, slug: string): Promise<string> {
  const id = `tenant-${slug}`
  const now = new Date().toISOString()
  h.sqlite
    .query(
      `insert into tenants (id, slug, name, status, localeCatalog, mediaAllowedMimeTypes, createdAt, updatedAt)
       values (?, ?, ?, 'active', '["en"]', '["image/png"]', ?, ?)`
    )
    .run(id, slug, slug, now, now)
  return id
}

beforeEach(() => {
  __resetAuthCacheForTests()
})

describe('global role input (privilege escalation guard)', () => {
  it('ignores a role supplied at sign-up', async () => {
    const h = setup()
    const res = await signUp(h, 'mallory@example.com', { role: 'superadmin' })
    expect(res.status).toBe(200)
    const row = h.sqlite.query('select role from user where email = ?').get('mallory@example.com')
    expect(row).toEqual({ role: 'viewer' })
  })

  it('rejects role changes through update-user', async () => {
    const h = setup()
    const jar = new CookieJar()
    await signUp(h, 'mallory@example.com', {}, jar)
    const res = await callAuth(h.auth, '/update-user', { body: { role: 'superadmin' }, jar })
    expect(res.status).toBe(400)
    const row = h.sqlite.query('select role from user where email = ?').get('mallory@example.com')
    expect(row).toEqual({ role: 'viewer' })
  })
})

describe('signup policy: open', () => {
  it('lets anyone create an account', async () => {
    const h = setup({ signupPolicy: 'open' })
    expect((await signUp(h, 'first@example.com')).status).toBe(200)
    expect((await signUp(h, 'second@example.com')).status).toBe(200)
    expect(userCount(h)).toBe(2)
  })
})

describe('signup policy: disabled', () => {
  it('allows only the bootstrap account of an empty deployment', async () => {
    const h = setup({ signupPolicy: 'disabled' })
    expect((await signUp(h, 'operator@example.com')).status).toBe(200)

    const blocked = await signUp(h, 'stranger@example.com')
    expect(blocked.status).toBe(403)
    expect(blocked.json.code).toBe('SIGNUP_DISABLED')
    expect(userCount(h)).toBe(1)
  })

  it('blocks account creation that bypasses the sign-up endpoint (social callbacks)', async () => {
    const h = setup({ signupPolicy: 'disabled' })
    await signUp(h, 'operator@example.com')
    await expect(
      enforceSignupPolicy(h.db, {
        policy: 'disabled',
        email: 'social@example.com',
        inviteToken: undefined,
        mode: 'consume',
      })
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('signup policy: invite-only', () => {
  async function inviteOnly() {
    const h = setup({ signupPolicy: 'invite-only' })
    await signUp(h, 'operator@example.com')
    return h
  }

  it('rejects sign-up without an invite', async () => {
    const h = await inviteOnly()
    const res = await signUp(h, 'guest@example.com')
    expect(res.status).toBe(403)
    expect(res.json.code).toBe('INVITE_REQUIRED')
  })

  it('accepts a valid invite once and grants its tenant membership', async () => {
    const h = await inviteOnly()
    const tenantId = await seedTenant(h, 'acme')
    const created = await invitesService.create(h.db, {
      email: 'Guest@Example.com',
      tenantSlug: 'acme',
      tenantRole: 'admin',
    })
    if (!created.success) throw new Error(created.error.message)
    const { token } = created.data

    const ok = await signUp(h, 'guest@example.com', { inviteToken: token })
    expect(ok.status).toBe(200)

    const user = h.sqlite.query('select id from user where email = ?').get('guest@example.com') as {
      id: string
    }
    expect(
      h.sqlite.query('select role from tenant_users where tenantId = ? and userId = ?').get(tenantId, user.id)
    ).toEqual({ role: 'admin' })
    expect(
      h.sqlite.query('select usedBy from signup_invites where email = ?').get('guest@example.com')
    ).toEqual({ usedBy: user.id })

    const reuse = await signUp(h, 'guest2@example.com', { inviteToken: token })
    expect(reuse.status).toBe(403)
    expect(reuse.json.code).toBe('INVITE_INVALID')
  })

  it('rejects an invite issued for another email', async () => {
    const h = await inviteOnly()
    const created = await invitesService.create(h.db, { email: 'invited@example.com' })
    if (!created.success) throw new Error(created.error.message)
    const res = await signUp(h, 'thief@example.com', { inviteToken: created.data.token })
    expect(res.status).toBe(403)
    expect(res.json.code).toBe('INVITE_INVALID')
  })

  it('accepts the invite token from the header', async () => {
    const h = await inviteOnly()
    const created = await invitesService.create(h.db, { email: 'header@example.com' })
    if (!created.success) throw new Error(created.error.message)
    const res = await callAuth(h.auth, '/sign-up/email', {
      body: { name: 'header', email: 'header@example.com', password: PASSWORD },
      headers: { 'x-edgecms-invite-token': created.data.token },
    })
    expect(res.status).toBe(200)
  })

  it('rejects expired and revoked invites', async () => {
    const h = await inviteOnly()
    const expired = await invitesService.create(h.db, { email: 'late@example.com' })
    const revoked = await invitesService.create(h.db, { email: 'revoked@example.com' })
    if (!expired.success || !revoked.success) throw new Error('invite create failed')
    h.sqlite.query('update signup_invites set expiresAt = 1 where id = ?').run(expired.data.invite.id)
    expect((await invitesService.revoke(h.db, revoked.data.invite.id)).success).toBe(true)

    expect((await signUp(h, 'late@example.com', { inviteToken: expired.data.token })).status).toBe(403)
    expect((await signUp(h, 'revoked@example.com', { inviteToken: revoked.data.token })).status).toBe(403)
    expect(userCount(h)).toBe(1)
  })

  it('lets only one of two concurrent consumers use an invite', async () => {
    const h = await inviteOnly()
    const created = await invitesService.create(h.db, { email: 'race@example.com' })
    if (!created.success) throw new Error(created.error.message)
    const input = {
      policy: 'invite-only' as const,
      email: 'race@example.com',
      inviteToken: created.data.token,
      mode: 'consume' as const,
    }
    const results = await Promise.allSettled([
      enforceSignupPolicy(h.db, input),
      enforceSignupPolicy(h.db, input),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })

  it('never stores the invite token itself', async () => {
    const h = await inviteOnly()
    const created = await invitesService.create(h.db, { email: 'hash@example.com' })
    if (!created.success) throw new Error(created.error.message)
    const row = h.sqlite.query('select tokenHash from signup_invites').get() as { tokenHash: string }
    expect(row.tokenHash).not.toBe(created.data.token)
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('email verification through an injected sender', () => {
  function withSender() {
    const sent: AuthEmailMessage[] = []
    const h = setup({ emailSender: { send: async (message) => void sent.push(message) } })
    return { h, sent }
  }

  it('blocks sign-in until the email is verified', async () => {
    const { h, sent } = withSender()
    const signup = await signUp(h, 'verify@example.com')
    expect(signup.status).toBe(200)
    expect(signup.json.token).toBeNull()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('verify@example.com')

    const blocked = await signIn(h, 'verify@example.com')
    expect(blocked.status).toBe(403)
    expect(blocked.json.code).toBe('EMAIL_NOT_VERIFIED')

    const link = sent[0]!.text.match(/https?:\/\/\S+/)?.[0]
    if (!link) throw new Error('verification link missing')
    const verifyPath = new URL(link).pathname.replace('/api/auth', '') + new URL(link).search
    const linkJar = new CookieJar()
    const verified = await callAuth(h.auth, verifyPath, { jar: linkJar })
    expect([200, 302]).toContain(verified.status)
    // The link verifies the address but never signs in by itself.
    expect(await getSession(h, linkJar)).toBeNull()

    expect((await signIn(h, 'verify@example.com')).status).toBe(200)
  })

  it('does not require verification when no sender is configured', async () => {
    const h = setup()
    await signUp(h, 'plain@example.com')
    expect((await signIn(h, 'plain@example.com')).status).toBe(200)
  })
})

describe('two-factor authentication (TOTP + recovery codes)', () => {
  async function enrolled(email = 'mfa@example.com') {
    const h = setup()
    const jar = new CookieJar()
    await signUp(h, email, {}, jar)
    const enable = await callAuth(h.auth, '/two-factor/enable', { body: { password: PASSWORD }, jar })
    expect(enable.status).toBe(200)
    const { totpURI, backupCodes } = enable.json as { totpURI: string; backupCodes: string[] }
    const confirm = await callAuth(h.auth, '/two-factor/verify-totp', {
      body: { code: await totpFromUri(totpURI) },
      jar,
    })
    expect(confirm.status).toBe(200)
    return { h, jar, totpURI, backupCodes, email }
  }

  it('marks plain password sessions as not MFA-verified', async () => {
    const h = setup()
    const jar = new CookieJar()
    await signUp(h, 'plain@example.com', {}, jar)
    expect((await getSession(h, jar))?.session.mfaVerified).toBe(false)
  })

  it('marks the session that completed enrolment as MFA-verified', async () => {
    const { h, jar } = await enrolled()
    const session = await getSession(h, jar)
    expect(session?.user.twoFactorEnabled).toBe(true)
    expect(session?.session.mfaVerified).toBe(true)
  })

  it('requires the TOTP challenge before a session exists', async () => {
    const { h, totpURI, email } = await enrolled()
    const jar = new CookieJar()
    const first = await signIn(h, email, jar)
    expect(first.status).toBe(200)
    expect(first.json.twoFactorRedirect).toBe(true)
    expect(await getSession(h, jar)).toBeNull()

    const wrong = await callAuth(h.auth, '/two-factor/verify-totp', { body: { code: '000000' }, jar })
    expect(wrong.status).toBe(401)
    expect(await getSession(h, jar)).toBeNull()

    const ok = await callAuth(h.auth, '/two-factor/verify-totp', {
      body: { code: await totpFromUri(totpURI) },
      jar,
    })
    expect(ok.status).toBe(200)
    expect((await getSession(h, jar))?.session.mfaVerified).toBe(true)
  })

  it('accepts a recovery code exactly once', async () => {
    const { h, backupCodes, email } = await enrolled()
    const code = backupCodes[0]!

    const jar = new CookieJar()
    await signIn(h, email, jar)
    const used = await callAuth(h.auth, '/two-factor/verify-backup-code', { body: { code }, jar })
    expect(used.status).toBe(200)
    expect((await getSession(h, jar))?.session.mfaVerified).toBe(true)

    const again = new CookieJar()
    await signIn(h, email, again)
    const reused = await callAuth(h.auth, '/two-factor/verify-backup-code', {
      body: { code },
      jar: again,
    })
    expect(reused.status).toBe(401)
    expect(await getSession(h, again)).toBeNull()
  })

  it('does not let a client set mfaVerified itself', async () => {
    const h = setup()
    const jar = new CookieJar()
    await signUp(h, 'sneaky@example.com', {}, jar)
    const res = await callAuth(h.auth, '/update-session', { body: { mfaVerified: true }, jar })
    expect(res.status).not.toBe(200)
    expect((await getSession(h, jar))?.session.mfaVerified).toBe(false)
  })

  it('keeps MFA when the session rotates on a password change', async () => {
    const { h, jar } = await enrolled()
    const res = await callAuth(h.auth, '/change-password', {
      body: { currentPassword: PASSWORD, newPassword: 'another-strong-pass', revokeOtherSessions: true },
      jar,
    })
    expect(res.status).toBe(200)
    expect((await getSession(h, jar))?.session.mfaVerified).toBe(true)
  })

  it('does not grant MFA when a password-only session rotates', async () => {
    const h = setup()
    const jar = new CookieJar()
    await signUp(h, 'rotate@example.com', {}, jar)
    await callAuth(h.auth, '/change-password', {
      body: { currentPassword: PASSWORD, newPassword: 'another-strong-pass', revokeOtherSessions: true },
      jar,
    })
    expect((await getSession(h, jar))?.session.mfaVerified).toBe(false)
  })

  it('clears MFA from the session when two-factor is disabled', async () => {
    const { h, jar } = await enrolled()
    const res = await callAuth(h.auth, '/two-factor/disable', { body: { password: PASSWORD }, jar })
    expect(res.status).toBe(200)
    const session = await getSession(h, jar)
    expect(session?.user.twoFactorEnabled).toBe(false)
    expect(session?.session.mfaVerified).toBe(false)
  })
})
