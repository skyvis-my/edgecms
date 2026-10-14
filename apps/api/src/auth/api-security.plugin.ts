import { env } from 'cloudflare:workers'
import { Elysia } from 'elysia'
import {
  applyApiSecurityHeaders,
  CORS_PREFLIGHT_CACHE_CONTROL,
  type MutableHeaders,
  parseBooleanEnv,
  setCorsHeaders,
  toResponseHeaders,
} from './cors'
import { requiresAuthorizationCheck, authorizeApiRequest } from './authorization'
import { parseAccessClaims, validateRequestJwt, type AccessTokenClaims } from './jwt'
import { resolveFastPathActor, type FastPathActor } from './access-token-guard'
import { requiresCsrf, validateCsrfToken } from './csrf.middleware'
import {
  consumeRateLimitDistributed,
  getRateLimitKey,
  getRateLimitPolicy,
} from './rate-limit.middleware'
import {
  type ActorRole,
  type TenantActorRole,
  resolveActorSessionDetails,
  resolveTenantRoleForActor,
} from './rbac'
import { rbacService } from './rbac.service'
import { hasSuperAdminRole, isSuperAdminEmail, parseSuperAdminEmails } from './super-admin'
import { createDb } from '@/database/db'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { getRequestPathname, getRequestUrl } from '@/shared/utils/request-url'
import { extractTenantSlug } from '@/tenants/tenant-path'
import { tenantsService } from '@/tenants/tenants.service'
import {
  getCachedTenant,
  setCachedTenant,
  getCachedMembership,
  setCachedMembership,
  setCachedFastActor,
} from '@/tenants/tenant-cache'
import { createErrorEnvelope } from '@/shared/utils/service-response'

function hasRequestPayload(request: Request): boolean {
  if (!['POST', 'PUT', 'PATCH'].includes(request.method.toUpperCase())) {
    return false
  }
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const parsed = Number(contentLength)
    if (Number.isFinite(parsed)) {
      return parsed > 0
    }
  }
  if (request.headers.has('transfer-encoding')) {
    return true
  }
  return request.body !== null
}

function isApiRequestPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function isHealthPath(pathname: string): boolean {
  return pathname === '/api' || pathname === '/api/health' || pathname === '/api/health/live'
}

function isAuthPath(pathname: string): boolean {
  return pathname === '/api/auth' || pathname.startsWith('/api/auth/')
}

function isBootstrapAuthPath(pathname: string): boolean {
  return pathname === '/api/bootstrap/provision-tenant'
}

function isSessionAuthPath(pathname: string): boolean {
  return pathname === '/api/me' || isBootstrapAuthPath(pathname)
}

function shouldResolveActorSession(pathname: string, method: string): boolean {
  return (
    isSessionAuthPath(pathname) ||
    requiresAuthorizationCheck(pathname, method) ||
    requiresCsrf(pathname, method)
  )
}

function shouldRateLimitRequest(pathname: string): boolean {
  if (!isApiRequestPath(pathname)) return false
  if (isHealthPath(pathname) || pathname === '/api/docs') return false
  return true
}

function isAssetsUploadPath(pathname: string): boolean {
  return pathname === '/api/admin/assets/upload' || pathname.endsWith('/admin/assets/upload')
}

function isSupportedContentType(pathname: string, contentTypeHeader: string | null): boolean {
  if (!contentTypeHeader) return false
  const contentType = contentTypeHeader.toLowerCase()
  if (isAssetsUploadPath(pathname)) {
    return (
      contentType.includes('application/json') || contentType.includes('multipart/form-data')
    )
  }
  return contentType.includes('application/json')
}

function unsupportedContentTypeMessage(pathname: string): string {
  if (isAssetsUploadPath(pathname)) {
    return 'Unsupported content type. Use application/json or multipart/form-data.'
  }
  return 'Unsupported content type. Use application/json.'
}

export type ApiSecurityGuardOptions = {
  hstsHeader?: string | null
  resolveAllowedCorsOrigin: (request: Request, pathname: string) => Promise<string | null>
}

/**
 * Elysia plugin for API security, CORS, rate limiting, and RBAC authorization.
 */
export function createApiSecurityGuardPlugin(options: ApiSecurityGuardOptions) {
  const { hstsHeader, resolveAllowedCorsOrigin } = options

  return new Elysia({ name: 'api-security-guard' })
    .onRequest(({ request, set }) => {
      const url = getRequestUrl(request)
      const pathname = url.pathname
      const headers = set.headers as MutableHeaders
      applyApiSecurityHeaders(headers, pathname)
      if (hstsHeader && url.protocol === 'https:') {
        headers['Strict-Transport-Security'] = hstsHeader
      }
      if (isApiRequestPath(pathname) && !isAuthPath(pathname) && hasRequestPayload(request)) {
        const contentType = request.headers.get('content-type')
        if (!isSupportedContentType(pathname, contentType)) {
          set.status = 415
          return createErrorEnvelope(
            'UNSUPPORTED_MEDIA_TYPE',
            unsupportedContentTypeMessage(pathname)
          )
        }
      }
    })
    .options('/*', async ({ request, set }) => {
      const pathname = getRequestPathname(request)
      const allowedOrigin = await resolveAllowedCorsOrigin(request, pathname)
      if (allowedOrigin) {
        setCorsHeaders(set.headers as MutableHeaders, allowedOrigin)
      } else {
        set.headers['Cache-Control'] = CORS_PREFLIGHT_CACHE_CONTROL
      }
      set.status = 204
      return new Response(null, {
        status: 204,
        headers: toResponseHeaders(set.headers as MutableHeaders),
      })
    })
    .onBeforeHandle('global', async (ctx) => {
      const pathname = (ctx as { pathname?: string }).pathname ?? getRequestPathname(ctx.request)
      const allowedOrigin = await resolveAllowedCorsOrigin(ctx.request, pathname)
      if (allowedOrigin) {
        setCorsHeaders(ctx.set.headers as MutableHeaders, allowedOrigin)
      }

      const method = ctx.request.method
      const tenantSlug = extractTenantSlug(pathname)
      const typedEnv = env as Env
      const shouldCheckAuthorization = requiresAuthorizationCheck(pathname, method)

      let accessClaims: AccessTokenClaims | undefined
      if (shouldCheckAuthorization) {
        const jwtValidation = await validateRequestJwt(ctx.request, {
          secret: typedEnv.JWT_HS256_SECRET,
          issuer: typedEnv.JWT_ISSUER,
          audience: typedEnv.JWT_AUDIENCE,
          required: parseBooleanEnv(typedEnv.JWT_REQUIRED_FOR_ADMIN),
        })
        if (!jwtValidation.valid) {
          ctx.set.status = 401
          return createErrorEnvelope(jwtValidation.code, jwtValidation.message)
        }
        if (jwtValidation.payload) {
          accessClaims = parseAccessClaims(jwtValidation.payload)
        }
      }

      // Stateless fast path: valid RBAC claims skip session + membership D1 reads.
      // Session-auth endpoints (/api/me) always use the session source of truth.
      // A stale token is rejected with TOKEN_STALE (never silently downgraded
      // to DB) so demotions take effect and the client refreshes promptly.
      let fastActor: FastPathActor | undefined
      if (accessClaims && shouldCheckAuthorization && !isSessionAuthPath(pathname)) {
        try {
          const fastResult = await resolveFastPathActor({
            claims: accessClaims,
            tenantSlug,
            kv: typedEnv.CACHE,
          })
          if (fastResult.kind === 'stale') {
            ctx.set.status = 401
            return createErrorEnvelope(
              'TOKEN_STALE',
              'Access token is stale; refresh and retry'
            )
          }
          fastActor = fastResult.kind === 'hit' ? fastResult.actor : undefined
          if (fastActor) {
            setCachedFastActor(ctx.request, fastActor, tenantSlug)
          }
        } catch (err) {
          logger.warn('fast_path_resolution_failed', {
            error: err instanceof Error ? err.message : String(err),
          })
          fastActor = undefined
        }
      }

      let actorId: string | undefined = fastActor?.actorId
      let actorRole: ActorRole | undefined = fastActor?.actorRole
      let actorSessionRoleRaw: string | undefined
      let actorUserRoleRaw: string | undefined
      let actorEmail: string | undefined = fastActor?.actorEmail
      if (!fastActor && shouldResolveActorSession(pathname, method)) {
        try {
          const actor = await resolveActorSessionDetails(ctx.request)
          actorId = actor.actorId
          actorRole = actor.actorRole
          actorSessionRoleRaw = actor.actorSessionRoleRaw
          actorUserRoleRaw = actor.actorUserRoleRaw
          actorEmail = actor.actorEmail
        } catch (err) {
          logger.warn('actor_session_resolution_failed', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      if (shouldRateLimitRequest(pathname)) {
        const clientIp = ctx.request.headers.get('cf-connecting-ip') ?? undefined
        const rateLimitPolicy = getRateLimitPolicy(pathname, method)
        const rate = await consumeRateLimitDistributed(
          getRateLimitKey(pathname, method, actorId, tenantSlug, clientIp),
          {
            kv: typedEnv.CACHE,
            windowMs: rateLimitPolicy.windowMs,
            limit: rateLimitPolicy.limit,
            source: ctx,
          }
        )
        if (!rate.allowed) {
          ctx.set.status = 429
          return createErrorEnvelope('RATE_LIMITED', 'Too many requests')
        }
      }

      if (
        requiresCsrf(pathname, method) &&
        !(await validateCsrfToken(ctx.request, typedEnv.BETTER_AUTH_SECRET!))
      ) {
        ctx.set.status = 403
        return createErrorEnvelope('CSRF_REQUIRED', 'Invalid or missing CSRF token')
      }

      if (shouldCheckAuthorization) {
        const superAdminEmails = parseSuperAdminEmails(typedEnv.SUPER_ADMIN_EMAILS)
        let tenantId: string | undefined = fastActor?.tenantId
        let tenantRole: TenantActorRole | undefined = fastActor?.tenantRole
        let fastCustomRole: string | undefined = fastActor?.customTenantRole
        const db = actorId && tenantSlug ? createDb(typedEnv.DB) : undefined

        if (fastActor && tenantSlug && !tenantId) {
          // Global-only token on a tenant route: fall back to DB for membership.
          fastCustomRole = undefined
          tenantId = undefined
          tenantRole = undefined
        }

        if ((!fastActor || (tenantSlug && !tenantId)) && actorId && tenantSlug && db) {
          let tenantPromise = getCachedTenant(ctx.request, tenantSlug)
          if (!tenantPromise) {
            tenantPromise = tenantsService
              .findByIdOrSlug(db, tenantSlug)
              .then((r) => (r.success ? r.data : undefined))
            setCachedTenant(ctx.request, tenantSlug, tenantPromise)
          }
          const tenantObj = await tenantPromise
          tenantId = tenantObj?.id

          let rolePromise = getCachedMembership(ctx.request, actorId, tenantSlug)
          if (!rolePromise) {
            rolePromise = resolveTenantRoleForActor(typedEnv.DB, actorId, tenantSlug).then(
              (r) => r ?? null
            )
            setCachedMembership(ctx.request, actorId, tenantSlug, rolePromise)
            if (tenantId) {
              setCachedMembership(ctx.request, actorId, tenantId, rolePromise)
            }
          }
          const roleResult = await rolePromise
          tenantRole = roleResult ? (roleResult as TenantActorRole) : undefined
        }

        const principal = {
          actorId,
          actorRole,
          tenantRole,
          isSuperAdmin:
            fastActor?.isSuperAdminByToken === true ||
            hasSuperAdminRole(actorSessionRoleRaw) ||
            hasSuperAdminRole(actorUserRoleRaw),
          isSuperAdminByEmail: isSuperAdminEmail(actorEmail, superAdminEmails),
        }

        let authorization = authorizeApiRequest({ pathname, method, principal })
        if (!authorization.allowed && authorization.code === 'FORBIDDEN' && tenantId && db) {
          // DB permissions are additive grants over role abilities. A deny from
          // role claims alone may still be allowed by a custom grant, so fetch
          // once and re-evaluate. Custom role names always need this lookup;
          // the common allow case stays at zero D1 reads.
          const roleForPerms = fastCustomRole ?? (!fastActor ? tenantRole : undefined)
          if (roleForPerms) {
            const permissionsResult = await rbacService.getEffectivePermissions(
              db,
              tenantId,
              roleForPerms
            )
            if (permissionsResult.success) {
              authorization = authorizeApiRequest({
                pathname,
                method,
                principal,
                customPermissions: permissionsResult.data,
              })
            }
          }
        }
        if (!authorization.allowed) {
          ctx.set.status = authorization.status
          return createErrorEnvelope(authorization.code, authorization.message)
        }
      }
    })
}
