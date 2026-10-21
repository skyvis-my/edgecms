import { env } from 'cloudflare:workers'
import { Elysia } from 'elysia'
import type { Env } from '@/env'
import {
  type AuthAuditAction,
  classifyAuthAuditAction,
  cookieHeaderFromResponse,
  recordAuthAuditEvent,
} from '@/audit/audit-recorders'
import { createDb } from '@/database/db'
import { getRequestUrl } from '@/shared/utils/request-url'
import { createAuthForEnv } from './auth'
import { getSessionForRequest } from './session-cache'
import { getCachedFastActor } from '@/tenants/tenant-cache'

/**
 * Elysia plugin that integrates better-auth with the CMS Worker.
 *
 * This plugin:
 * 1. Mounts better-auth's request handler at /api/auth/* to serve
 *    sign-up, sign-in, sign-out, and session endpoints.
 * 2. Provides an `auth` macro for route-level session validation.
 *    When `{ auth: true }` is set on a route, the macro resolves
 *    the current session and user from request headers and exposes
 *    them as `user` and `session` on the route context. If no valid
 *    session exists, a 401 response is returned automatically.
 *
 * @example
 * ```ts
 * import { betterAuthPlugin } from '@/auth/auth.middleware'
 *
 * const app = new Elysia()
 *   .use(betterAuthPlugin)
 *   .get('/api/protected', ({ user }) => ({ message: `Hello ${user.name}` }), {
 *     auth: true,
 *   })
 * ```
 */
export const handleBetterAuth = (request: Request) => {
  const typedEnv = env as unknown as Env
  const url = getRequestUrl(request)
  const baseURL = url.origin
  const auth = createAuthForEnv(typedEnv, baseURL)
  const pathname = url.pathname.startsWith('/api/auth')
    ? url.pathname
    : `/api/auth${url.pathname}`
  const fullUrl = new URL(`${pathname}${url.search}`, url.origin)
  const fullRequest = new Request(fullUrl.toString(), request)
  const auditAction = classifyAuthAuditAction(pathname, request.method)
  if (!auditAction) return auth.handler(fullRequest)
  return handleAuditedAuthRequest(auth, fullRequest, auditAction, pathname, typedEnv)
}

async function resolveSessionUserId(
  auth: ReturnType<typeof createAuth>,
  headers: Headers
): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers })
    return session?.user?.id ?? null
  } catch {
    return null
  }
}

async function userIdFromResponseBody(response: Response): Promise<string | null> {
  if (!response.headers.get('content-type')?.includes('application/json')) return null
  try {
    const body = (await response.clone().json()) as { user?: { id?: unknown } } | null
    return typeof body?.user?.id === 'string' ? body.user.id : null
  } catch {
    return null
  }
}

/** HS-12: record sign-in, sign-up and sign-out outcomes in the global audit chain. */
async function handleAuditedAuthRequest(
  auth: ReturnType<typeof createAuth>,
  request: Request,
  action: AuthAuditAction,
  pathname: string,
  typedEnv: Env
): Promise<Response> {
  const signOutUserId =
    action === 'auth.sign_out' ? await resolveSessionUserId(auth, request.headers) : null
  const response: Response = await auth.handler(request)
  let userId = signOutUserId
  if (action !== 'auth.sign_out' && response.status < 400) {
    const cookie = cookieHeaderFromResponse(response)
    userId = cookie ? await resolveSessionUserId(auth, new Headers({ cookie })) : null
    // Sign-up with email verification returns the new user without a session.
    userId ??= await userIdFromResponseBody(response)
  }
  await recordAuthAuditEvent({
    db: createDb(typedEnv.DB),
    env: typedEnv,
    action,
    pathname,
    response,
    userId,
  })
  return response
}

export const betterAuthPlugin = new Elysia({ name: 'better-auth' })
  .macro({
    auth: {
      async derive({ status, request }) {
        // Stateless fast path: a verified FastPathActor cached on this Request
        // by the api-security guard synthesizes { user, session } with zero D1.
        // /api/me always uses the session source of truth.
        const pathname = getRequestUrl(request).pathname
        if (pathname !== '/api/me') {
          const cached = getCachedFastActor(request)
          if (cached) {
            const fast = cached.actor
            const email = fast.actorEmail ?? ''
            const role = fast.isSuperAdminByToken
              ? 'super_admin'
              : (fast.actorRole ?? 'viewer')
            return {
              user: {
                id: fast.actorId,
                name: email || fast.actorId,
                email,
                emailVerified: fast.emailVerified === true,
                role,
              },
              session: {
                id: `fastpath:${fast.actorId}`,
                userId: fast.actorId,
                role,
              },
            }
          }
        }

        const typedEnv = env as unknown as Env
        const baseURL = getRequestUrl(request).origin
        const auth = createAuthForEnv(typedEnv, baseURL)

        const result = await getSessionForRequest(auth, request)

        if (!result) return status(401)

        return {
          user: result.user,
          session: result.session,
        }
      },
    },
  })
