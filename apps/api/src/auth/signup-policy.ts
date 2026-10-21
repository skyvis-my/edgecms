import { APIError } from 'better-auth/api'
import type { Database } from '@/database/db'
import { invitesService } from '@/invites/invites.service'
import { usersRepository } from '@/users/users.repository'
import type { SignupPolicy } from './auth-policies'

/** Header alternative to the `inviteToken` sign-up body field. */
export const INVITE_TOKEN_HEADER = 'x-edgecms-invite-token'

const MAX_INVITE_TOKEN_LENGTH = 256

type HookContext =
  | {
      body?: unknown
      headers?: Headers
      request?: Request
    }
  | null
  | undefined

/** Reads an invite token from the sign-up body (`inviteToken`) or header. */
export function readInviteToken(ctx: HookContext): string | undefined {
  const body = ctx?.body
  const fromBody =
    body && typeof body === 'object' ? (body as { inviteToken?: unknown }).inviteToken : undefined
  const raw =
    typeof fromBody === 'string'
      ? fromBody
      : (ctx?.headers?.get(INVITE_TOKEN_HEADER) ??
        ctx?.request?.headers.get(INVITE_TOKEN_HEADER) ??
        undefined)
  const token = raw?.trim()
  if (!token || token.length > MAX_INVITE_TOKEN_LENGTH) return undefined
  return token
}

function rejectSignup(code: string, message: string): never {
  throw new APIError('FORBIDDEN', { code, message })
}

/**
 * Enforces the signup policy for one new account (PRD HS-01).
 *
 * `check` validates without side effects (early, clear error on the sign-up
 * endpoint). `consume` is authoritative: it runs right before the user row is
 * written, for every account creation path (email and social), and atomically
 * uses up the invite so it cannot be replayed.
 *
 * The first account of an empty deployment is always allowed so operators can
 * bootstrap a fresh install under `disabled` or `invite-only`.
 */
export async function enforceSignupPolicy(
  db: Database,
  input: {
    policy: SignupPolicy
    email: string
    inviteToken: string | undefined
    mode: 'check' | 'consume'
  }
): Promise<void> {
  if (input.policy === 'open') return
  if ((await usersRepository.countAll(db)) === 0) return

  if (input.policy === 'disabled') {
    rejectSignup('SIGNUP_DISABLED', 'Sign-up is disabled on this deployment')
  }

  if (!input.inviteToken) {
    rejectSignup('INVITE_REQUIRED', 'Sign-up requires an invite')
  }

  const ok =
    input.mode === 'check'
      ? await invitesService.isUsable(db, { token: input.inviteToken, email: input.email })
      : Boolean(await invitesService.consume(db, { token: input.inviteToken, email: input.email }))
  if (!ok) {
    rejectSignup('INVITE_INVALID', 'Invite is invalid, expired, already used or for another email')
  }
}
