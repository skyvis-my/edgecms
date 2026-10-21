import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { parseBooleanEnv } from '@/shared/utils/env-flags'

/**
 * Hosting seams for authentication (PRD HS-01, HS-11).
 *
 * Policies are fixed at composition time: either from Worker env vars or from
 * `configureAuthPolicies()` called once by the host before serving requests.
 * Request input never changes them.
 */

/**
 * - `open`: anyone may create an account (historical behavior, runtime default).
 * - `invite-only`: a new account needs a valid, unused invite bound to its email.
 * - `disabled`: no new accounts. Recommended for new deployments.
 *
 * Under every policy the very first account of an empty deployment may still be
 * created, so an operator can bootstrap a fresh install.
 */
export type SignupPolicy = 'open' | 'invite-only' | 'disabled'

export const SIGNUP_POLICIES: readonly SignupPolicy[] = ['open', 'invite-only', 'disabled']

export type AuthEmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
}

/** Injected transport for auth emails. EdgeCMS never hard-codes a provider. */
export interface AuthEmailSender {
  send(message: AuthEmailMessage): Promise<void>
}

export type AuthPolicies = {
  signupPolicy: SignupPolicy
  /** When set, email/password accounts must verify their email before signing in. */
  emailSender?: AuthEmailSender
  /** Require a second factor for super-admins on every admin route. */
  requireMfaForSuperAdmins: boolean
}

export type AuthPolicyOverrides = Partial<AuthPolicies>

/**
 * Development sender: writes the message to the Worker log instead of sending it.
 * Never use in production; links in the log are bearer credentials.
 */
export function createConsoleEmailSender(
  write: (line: string, data: Record<string, unknown>) => void = (line, data) =>
    logger.info(line, data)
): AuthEmailSender {
  return {
    async send(message) {
      write('auth_email_console_sender', {
        to: message.to,
        subject: message.subject,
        text: message.text,
      })
    },
  }
}

export function isSignupPolicy(value: unknown): value is SignupPolicy {
  return typeof value === 'string' && (SIGNUP_POLICIES as readonly string[]).includes(value)
}

/**
 * Parses `SIGNUP_POLICY`. Unset means `open` so existing self-hosted
 * deployments keep working. An unrecognized value fails closed to `disabled`;
 * `validateAuthPolicyEnv` rejects it at bootstrap.
 */
export function parseSignupPolicy(raw: string | undefined): SignupPolicy {
  if (raw === undefined || raw.trim() === '') return 'open'
  const normalized = raw.trim().toLowerCase()
  return isSignupPolicy(normalized) ? normalized : 'disabled'
}

/** Throws on auth policy env values that cannot be honored. */
export function validateAuthPolicyEnv(env: Partial<Env>): void {
  const rawPolicy = env.SIGNUP_POLICY
  if (rawPolicy !== undefined && rawPolicy.trim() !== '') {
    if (!isSignupPolicy(rawPolicy.trim().toLowerCase())) {
      throw new Error(`SIGNUP_POLICY must be one of: ${SIGNUP_POLICIES.join(', ')}`)
    }
  }
  const rawSender = env.AUTH_EMAIL_SENDER
  if (rawSender !== undefined && rawSender.trim() !== '' && rawSender.trim() !== 'console') {
    throw new Error('AUTH_EMAIL_SENDER only supports "console"; inject other senders in code')
  }
}

let configuredOverrides: AuthPolicyOverrides = {}

/**
 * Sets auth policies from code (for example a host passing its own email
 * sender). Call once while composing the Worker, before it serves requests.
 * Values given here win over env vars.
 */
export function configureAuthPolicies(overrides: AuthPolicyOverrides): void {
  if (overrides.signupPolicy !== undefined && !isSignupPolicy(overrides.signupPolicy)) {
    throw new Error(`signupPolicy must be one of: ${SIGNUP_POLICIES.join(', ')}`)
  }
  configuredOverrides = { ...overrides }
}

export function __resetAuthPoliciesForTests(): void {
  configuredOverrides = {}
}

let consoleSender: AuthEmailSender | undefined

export function resolveAuthPolicies(env: Partial<Env>): AuthPolicies {
  const envSender =
    env.AUTH_EMAIL_SENDER?.trim() === 'console'
      ? (consoleSender ??= createConsoleEmailSender())
      : undefined
  return {
    signupPolicy: configuredOverrides.signupPolicy ?? parseSignupPolicy(env.SIGNUP_POLICY),
    emailSender: configuredOverrides.emailSender ?? envSender,
    requireMfaForSuperAdmins:
      configuredOverrides.requireMfaForSuperAdmins ??
      parseBooleanEnv(env.SUPER_ADMIN_REQUIRE_MFA),
  }
}
