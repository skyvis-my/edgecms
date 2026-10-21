import { env } from 'cloudflare:workers'
import { Elysia, t } from 'elysia'
import { isSuperAdminUser } from '@/audit/audit-access'
import { resolveAuditRetentionDays } from '@/audit/audit.service'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { createDb } from '@/database/db'
import type { Env } from '@/env'
import { createErrorEnvelope, toServiceResponse } from '@/shared/utils/service-response'
import { privacyService } from './privacy.service'

type MutableHeaders = Record<string, string | string[]>

const deletionBody = t.Object({
  /** Explicit confirmation so a stray request can never delete an account. */
  confirm: t.Literal('DELETE'),
})

const SESSION_COOKIES = [
  'better-auth.session_token',
  'better-auth.session_data',
  '__Secure-better-auth.session_token',
  '__Secure-better-auth.session_data',
]

/** `__Secure-` cookies are only replaced when the clearing cookie is Secure too. */
function clearCookieHeader(name: string): string {
  const secure = name.startsWith('__Secure-') ? '; Secure' : ''
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
}

function workerEnv(): Env {
  return env as unknown as Env
}

function forbidUnlessSuperAdmin(
  user: { id: string; email?: string | null; role?: unknown } | undefined,
  set: { status?: number | string | unknown }
) {
  if (isSuperAdminUser(user, workerEnv())) return null
  set.status = 403
  return createErrorEnvelope('FORBIDDEN', 'Super-admin access required')
}

/**
 * HS-13 personal data requests.
 *
 *   GET  /api/me/data-export                         — the signed-in user's data
 *   POST /api/me/data-deletion { confirm: 'DELETE' } — delete own account
 *   GET  /api/admin/users/:userId/data-export        — super-admin, any user
 *   POST /api/admin/users/:userId/data-deletion      — super-admin, any user
 */
export const privacyController = new Elysia()
  .use(betterAuthPlugin)
  .get('/api/me/data-export', { auth: true }, async ({ user, set }) => {
    const typedEnv = workerEnv()
    const result = await privacyService.exportUserData(
      createDb(typedEnv.DB),
      user.id,
      { kind: 'self', actorId: user.id },
      { retentionDays: resolveAuditRetentionDays(typedEnv.AUDIT_RETENTION_DAYS) }
    )
    set.headers['cache-control'] = 'no-store'
    return toServiceResponse(set, result)
  })
  .post('/api/me/data-deletion', { auth: true, body: deletionBody }, async ({ user, set }) => {
    const typedEnv = workerEnv()
    const result = await privacyService.deleteUserData(
      createDb(typedEnv.DB),
      user.id,
      { kind: 'self', actorId: user.id },
      {
        kv: typedEnv.CACHE,
        retentionDays: resolveAuditRetentionDays(typedEnv.AUDIT_RETENTION_DAYS),
      }
    )
    if (result.success) {
      ;(set.headers as MutableHeaders)['set-cookie'] = SESSION_COOKIES.map(
        clearCookieHeader
      )
    }
    set.headers['cache-control'] = 'no-store'
    return toServiceResponse(set, result)
  })
  .get('/api/admin/users/:userId/data-export', { auth: true }, async ({ user, params, set }) => {
    const denied = forbidUnlessSuperAdmin(user, set)
    if (denied) return denied
    const typedEnv = workerEnv()
    const result = await privacyService.exportUserData(
      createDb(typedEnv.DB),
      params.userId,
      { kind: 'super_admin', actorId: user.id },
      { retentionDays: resolveAuditRetentionDays(typedEnv.AUDIT_RETENTION_DAYS) }
    )
    set.headers['cache-control'] = 'no-store'
    return toServiceResponse(set, result)
  })
  .post(
    '/api/admin/users/:userId/data-deletion',
    { auth: true, body: deletionBody },
    async ({ user, params, set }) => {
      const denied = forbidUnlessSuperAdmin(user, set)
      if (denied) return denied
      const typedEnv = workerEnv()
      const result = await privacyService.deleteUserData(
        createDb(typedEnv.DB),
        params.userId,
        { kind: 'super_admin', actorId: user.id },
        {
          kv: typedEnv.CACHE,
          retentionDays: resolveAuditRetentionDays(typedEnv.AUDIT_RETENTION_DAYS),
        }
      )
      set.headers['cache-control'] = 'no-store'
      return toServiceResponse(set, result)
    }
  )
