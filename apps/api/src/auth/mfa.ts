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
 * Returns why the caller must present MFA, or undefined when it is not needed.
 * Super-admins are covered deployment-wide; everyone else per tenant.
 */
export function resolveMfaRequirement(input: {
  isSuperAdmin: boolean
  requireMfaForSuperAdmins: boolean
  tenantRequiresMfa: boolean
}): 'super-admin' | 'tenant' | undefined {
  if (input.isSuperAdmin && input.requireMfaForSuperAdmins) return 'super-admin'
  if (input.tenantRequiresMfa) return 'tenant'
  return undefined
}
