import { env } from 'cloudflare:workers'
import { Elysia } from 'elysia'
import type { Env } from '@/env'
import { getRequestUrl } from '@/shared/utils/request-url'
import { createAuth } from './auth'
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
  const auth = createAuth(typedEnv.DB, {
    secret: typedEnv.BETTER_AUTH_SECRET,
    baseURL,
    entra: {
      clientId: typedEnv.ENTRA_CLIENT_ID,
      clientSecret: typedEnv.ENTRA_CLIENT_SECRET,
      tenantId: typedEnv.ENTRA_TENANT_ID,
    },
    google: {
      clientId: typedEnv.GOOGLE_CLIENT_ID,
      clientSecret: typedEnv.GOOGLE_CLIENT_SECRET,
    },
  })
  const pathname = url.pathname.startsWith('/api/auth')
    ? url.pathname
    : `/api/auth${url.pathname}`
  const fullUrl = new URL(`${pathname}${url.search}`, url.origin)
  const fullRequest = new Request(fullUrl.toString(), request)
  return auth.handler(fullRequest)
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
        const auth = createAuth(typedEnv.DB, {
          secret: typedEnv.BETTER_AUTH_SECRET,
          baseURL,
          entra: {
            clientId: typedEnv.ENTRA_CLIENT_ID,
            clientSecret: typedEnv.ENTRA_CLIENT_SECRET,
            tenantId: typedEnv.ENTRA_TENANT_ID,
          },
          google: {
            clientId: typedEnv.GOOGLE_CLIENT_ID,
            clientSecret: typedEnv.GOOGLE_CLIENT_SECRET,
          },
        })

        const result = await getSessionForRequest(auth, request)

        if (!result) return status(401)

        return {
          user: result.user,
          session: result.session,
        }
      },
    },
  })
