import type { Database } from '@/database/db'
import type { Env } from '@/env'
import type { CommandEnvelope, CommandResult } from '@edgecms/schemas/commands'
import { AUDIT_GLOBAL_SCOPE } from './audit-chain'
import { getAuditDb } from './audit-access'
import { auditService, resolveAuditRetentionDays } from './audit.service'

const COMMAND_REFERENCE_KEYS = ['entryId', 'collectionSlug', 'collectionId', 'locale'] as const

function commandReferences(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {}
  const source = payload as Record<string, unknown>
  const refs: Record<string, unknown> = {}
  for (const key of COMMAND_REFERENCE_KEYS) {
    if (typeof source[key] === 'string') refs[key] = source[key]
  }
  if (Array.isArray(source.entryIds)) refs.entryCount = source.entryIds.length
  if (Array.isArray(source.commands)) refs.commandCount = source.commands.length
  return refs
}

/**
 * Append one `command.executed` event for an executed (non dry-run) command
 * or transaction. Never throws: the mutation has already committed.
 */
export async function recordCommandAuditEvent(input: {
  db: Database
  env?: Env
  tenantScope?: string | null
  envelope: CommandEnvelope
  result: CommandResult
}): Promise<void> {
  const { envelope, result } = input
  if (result.status === 'dry_run') return
  await auditService.recordSafely(
    getAuditDb(input.env, input.db),
    {
      scope: input.tenantScope || AUDIT_GLOBAL_SCOPE,
      category: 'command',
      action: 'command.executed',
      outcome: result.status === 'success' ? 'success' : 'failure',
      actorId: envelope.actor.userId,
      actorSource: envelope.actor.source,
      targetType: 'command',
      targetId: result.commandId,
      metadata: {
        commandType: envelope.type,
        ...commandReferences(envelope.payload),
        ...(result.error ? { errorCode: result.error.code } : {}),
      },
    },
    { retentionDays: resolveAuditRetentionDays(input.env?.AUDIT_RETENTION_DAYS) }
  )
}

export type AuthAuditAction = 'auth.sign_in' | 'auth.sign_up' | 'auth.sign_out'

/** Map a Better Auth endpoint to the audit action it represents, if any. */
export function classifyAuthAuditAction(pathname: string, method: string): AuthAuditAction | null {
  const path = pathname.replace(/^\/api\/auth/, '').replace(/\/+$/, '')
  if (path.startsWith('/callback/')) return 'auth.sign_in'
  if (method !== 'POST') return null
  // Social sign-in only starts the OAuth redirect; the callback records the outcome.
  if (path === '/sign-in/social') return null
  if (path.startsWith('/sign-in/')) return 'auth.sign_in'
  if (path.startsWith('/sign-up/')) return 'auth.sign_up'
  if (path === '/sign-out') return 'auth.sign_out'
  return null
}

function authProvider(pathname: string): string | undefined {
  const match = /\/(?:sign-in|sign-up|callback)\/([^/?]+)/.exec(pathname)
  return match?.[1]
}

/** `Cookie` header value built from a response's `Set-Cookie` headers. */
export function cookieHeaderFromResponse(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const values =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (response.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=\s]+=)/)
  const pairs = values
    .map((value) => value.split(';')[0]?.trim() ?? '')
    .filter((pair) => pair.includes('=') && !pair.endsWith('='))
  return pairs.length > 0 ? pairs.join('; ') : null
}

/**
 * Record a sign-in, sign-up or sign-out in the global chain. Only the user id
 * is stored: no email, IP or user agent. Failed attempts are recorded without
 * an identity. Never throws.
 */
export async function recordAuthAuditEvent(input: {
  db: Database
  env?: Env
  action: AuthAuditAction
  pathname: string
  response: Response
  /** User id for the session the response created (sign-in/up) or ended (sign-out). */
  userId: string | null
}): Promise<void> {
  const redirectedWithError =
    input.response.status >= 300 &&
    input.response.status < 400 &&
    /[?&]error=/.test(input.response.headers.get('location') ?? '')
  const succeeded = input.response.status < 400 && !redirectedWithError && Boolean(input.userId)
  const provider = authProvider(input.pathname)
  await auditService.recordSafely(
    input.db,
    {
      scope: AUDIT_GLOBAL_SCOPE,
      category: 'auth',
      action: input.action,
      outcome: succeeded ? 'success' : 'failure',
      actorId: succeeded ? input.userId : null,
      actorSource: 'user',
      targetType: succeeded ? 'user' : null,
      targetId: succeeded ? input.userId : null,
      metadata: {
        ...(provider ? { provider } : {}),
        status: input.response.status,
        // false for a 2xx that created no session (e.g. a pending second factor).
        identityResolved: Boolean(input.userId),
      },
    },
    { retentionDays: resolveAuditRetentionDays(input.env?.AUDIT_RETENTION_DAYS) }
  )
}
