import type { Env } from '@/env'
import { resolveAuthPolicies } from './auth-policies'
import { hasSuperAdminRole, isSuperAdminUser } from './super-admin'

/**
 * MFA enforcement helpers (PRD HS-11).
 *
 * A session counts as MFA-verified only when better-auth created it by
 * completing a second-factor challenge (TOTP or recovery code); see
 * `isSecondFactorPath` in `auth.ts`. Social sign-ins never get that flag.
 */

export const MFA_REQUIRED_CODE = 'MFA_REQUIRED'

export const MFA_REQUIRED_MESSAGE =
  'Multi-factor authentication is required. Set up two-factor authentication in your profile, or sign in again with your authenticator code.'

/** Reads the `mfaVerified` flag from a better-auth `getSession` result. */
export function isMfaVerifiedSession(session: unknown): boolean {
  const inner = (session as { session?: { mfaVerified?: unknown } } | null | undefined)?.session
  return inner?.mfaVerified === true || inner?.mfaVerified === 1
}

/**
 * True when a super-admin session must present MFA (SUPER_ADMIN_REQUIRE_MFA)
 * and has not. Covers super-admins by role, by SUPER_ADMIN_EMAILS and by
 * SUPER_ADMIN_DEV_MODE, matching `isSuperAdminUser`.
 */
export function isSuperAdminMissingMfa(
  input: {
    email?: string | null
    emailVerified?: boolean | null
    userRole?: unknown
    sessionRole?: unknown
    mfaVerified: boolean
  },
  env: Partial<Env>
): boolean {
  if (input.mfaVerified) return false
  if (!resolveAuthPolicies(env).requireMfaForSuperAdmins) return false
  return (
    hasSuperAdminRole(input.sessionRole) ||
    isSuperAdminUser(
      { email: input.email, emailVerified: input.emailVerified, role: input.userRole },
      env
    )
  )
}
