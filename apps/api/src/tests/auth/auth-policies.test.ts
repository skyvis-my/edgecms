import { afterEach, describe, expect, it } from 'bun:test'
import {
  __resetAuthPoliciesForTests,
  configureAuthPolicies,
  createConsoleEmailSender,
  parseSignupPolicy,
  resolveAuthPolicies,
  validateAuthPolicyEnv,
} from '@/auth/auth-policies'
import { readInviteToken } from '@/auth/signup-policy'
import { isMfaVerifiedSession, isSuperAdminMissingMfa } from '@/auth/mfa'

afterEach(() => {
  __resetAuthPoliciesForTests()
})

describe('parseSignupPolicy', () => {
  it('defaults to open so existing deployments keep working', () => {
    expect(parseSignupPolicy(undefined)).toBe('open')
    expect(parseSignupPolicy('  ')).toBe('open')
  })

  it('accepts the three policies case-insensitively', () => {
    expect(parseSignupPolicy('open')).toBe('open')
    expect(parseSignupPolicy('Invite-Only')).toBe('invite-only')
    expect(parseSignupPolicy('DISABLED')).toBe('disabled')
  })

  it('fails closed on unknown values', () => {
    expect(parseSignupPolicy('closed')).toBe('disabled')
  })
})

describe('validateAuthPolicyEnv', () => {
  it('rejects unknown signup policies and senders at bootstrap', () => {
    expect(() => validateAuthPolicyEnv({ SIGNUP_POLICY: 'closed' })).toThrow('SIGNUP_POLICY')
    expect(() => validateAuthPolicyEnv({ AUTH_EMAIL_SENDER: 'smtp' })).toThrow('AUTH_EMAIL_SENDER')
  })

  it('accepts valid values', () => {
    expect(() =>
      validateAuthPolicyEnv({ SIGNUP_POLICY: 'invite-only', AUTH_EMAIL_SENDER: 'console' })
    ).not.toThrow()
  })
})

describe('resolveAuthPolicies', () => {
  it('reads env vars', () => {
    const policies = resolveAuthPolicies({
      SIGNUP_POLICY: 'disabled',
      AUTH_EMAIL_SENDER: 'console',
      SUPER_ADMIN_REQUIRE_MFA: 'true',
    })
    expect(policies.signupPolicy).toBe('disabled')
    expect(policies.emailSender).toBeDefined()
    expect(policies.requireMfaForSuperAdmins).toBe(true)
  })

  it('keeps historical behavior with no configuration', () => {
    expect(resolveAuthPolicies({})).toEqual({
      signupPolicy: 'open',
      emailSender: undefined,
      requireMfaForSuperAdmins: false,
    })
  })

  it('lets composition-time overrides win over env', () => {
    const sender = { send: async () => {} }
    configureAuthPolicies({ signupPolicy: 'invite-only', emailSender: sender })
    const policies = resolveAuthPolicies({ SIGNUP_POLICY: 'open' })
    expect(policies.signupPolicy).toBe('invite-only')
    expect(policies.emailSender).toBe(sender)
  })

  it('rejects invalid overrides', () => {
    expect(() => configureAuthPolicies({ signupPolicy: 'nope' as never })).toThrow()
  })
})

describe('createConsoleEmailSender', () => {
  it('writes the message instead of sending it', async () => {
    const lines: Record<string, unknown>[] = []
    await createConsoleEmailSender((_line, data) => lines.push(data)).send({
      to: 'a@example.com',
      subject: 'Hi',
      text: 'link',
    })
    expect(lines).toEqual([{ to: 'a@example.com', subject: 'Hi', text: 'link' }])
  })
})

describe('readInviteToken', () => {
  it('prefers the body and falls back to the header', () => {
    expect(readInviteToken({ body: { inviteToken: ' abc ' } })).toBe('abc')
    expect(readInviteToken({ headers: new Headers({ 'x-edgecms-invite-token': 'hdr' }) })).toBe('hdr')
    expect(readInviteToken(null)).toBeUndefined()
    expect(readInviteToken({ body: { inviteToken: 'x'.repeat(300) } })).toBeUndefined()
  })
})

describe('MFA helpers', () => {
  it('reads the mfaVerified session flag', () => {
    expect(isMfaVerifiedSession({ session: { mfaVerified: true } })).toBe(true)
    expect(isMfaVerifiedSession({ session: { mfaVerified: 1 } })).toBe(true)
    expect(isMfaVerifiedSession({ session: {} })).toBe(false)
    expect(isMfaVerifiedSession(null)).toBe(false)
  })

  it('decides when a super-admin is missing MFA', () => {
    const required = { SUPER_ADMIN_REQUIRE_MFA: 'true', SUPER_ADMIN_EMAILS: 'root@example.com' }
    const root = { email: 'root@example.com', mfaVerified: false }
    expect(isSuperAdminMissingMfa(root, required)).toBe(true)
    expect(isSuperAdminMissingMfa({ ...root, mfaVerified: true }, required)).toBe(false)
    expect(isSuperAdminMissingMfa(root, { SUPER_ADMIN_EMAILS: 'root@example.com' })).toBe(false)
    expect(isSuperAdminMissingMfa({ email: 'x@example.com', mfaVerified: false }, required)).toBe(false)
    expect(
      isSuperAdminMissingMfa({ email: 'x@example.com', userRole: 'superadmin', mfaVerified: false }, required)
    ).toBe(true)
    expect(
      isSuperAdminMissingMfa(
        { email: 'x@example.com', mfaVerified: false },
        { SUPER_ADMIN_REQUIRE_MFA: 'true', SUPER_ADMIN_DEV_MODE: 'true' }
      )
    ).toBe(true)
  })
})
