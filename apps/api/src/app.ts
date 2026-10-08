import { env } from 'cloudflare:workers'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import { aiController } from '@/ai/ai.controller'
import { warmPublicCache } from '@/cache/cache-warming'
import { assetsController } from '@/assets/assets.controller'
import { cacheStatsController } from '@/cache/cache-stats.controller'
import { systemController } from '@/system/system.controller'
import { betterAuthPlugin } from '@/auth/auth.middleware'
import { authorizeApiRequest, requiresAuthorizationCheck } from '@/auth/authorization'
import {
  createSignedCsrfToken,
  formatCsrfCookieHeader,
  requiresCsrf,
  validateCsrfToken,
} from '@/auth/csrf.middleware'
import { validateRequestJwt } from '@/auth/jwt'
import {
  consumeRateLimitDistributed,
  getRateLimitKey,
  getRateLimitPolicy,
} from '@/auth/rate-limit.middleware'
import { resolveActorSessionDetails, resolveTenantRoleForActor } from '@/auth/rbac'
import type { ActorRole, TenantActorRole } from '@/auth/rbac'
import { rbacService } from '@/auth/rbac.service'
import { rbacController } from '@/auth/rbac.controller'
import { hasSuperAdminRole, isSuperAdminEmail, parseSuperAdminEmails } from '@/auth/super-admin'
import { ensureUserHasOnboardingTenant } from '@/bootstrap/onboarding-tenant'
import { collectionsController } from '@/collections/collections.controller'
import { collectionsRepository } from '@/collections/collections.repository'
import { commandsController } from '@/commands/commands.controller'
import { createDb } from '@/database/db'
import { entriesController } from '@/entries/entries.controller'
import type { Env } from '@/env'
import { buildHealthStatus } from '@/health'
import {
  createMetricsRegistry,
  createRequestMetrics,
  defaultMetricsRegistry,
  type MetricSink,
  type MetricsRegistry,
} from '@/observability/metrics'
import { logger } from '@/observability/logger'
import { getOrCreateRequestId, setRequestIdHeader, createTraceparentHeader } from '@/observability/tracing'
import { getRequestUrl, getRequestPathname } from '@/shared/utils/request-url'
import {
  createLoadedPluginRoutesController,
  getPluginRuntimeForRegistry,
  type PluginRuntime,
  reloadConfiguredPlugins,
} from '@/plugins/plugin-loader'
import { type PluginRegistry, pluginRegistry } from '@/plugins/plugin-registry'
import { parsePluginHookTimeoutMs } from '@/runtime/bootstrap'
import { createPluginsController, pluginsController } from '@/plugins/plugins.controller'
import { mcpController } from '@/mcp/mcp.controller'
import { publicController } from '@/public/public.controller'
import { publicService } from '@/public/public.service'
import { applyPublicAssetFormatAliases } from '@/public/public-assets-path-normalizer'
import { relationsController } from '@/relations/relations.controller'
import { syncController } from '@/sync/sync.controller'
import { tenantMiddleware } from '@/tenants/tenant.middleware'
import { getCachedCorsOrigin } from '@/tenants/cors-cache'
import { extractTenantSlug } from '@/tenants/tenant-path'
import { applyTenantPathAliases, normalizeTenantScopedPath } from '@/tenants/tenant-path-normalizer'
import { tenantsController } from '@/tenants/tenants.controller'
import { tenantsService } from '@/tenants/tenants.service'
import { usersRepository } from '@/users/users.repository'
import { usersController } from '@/users/users.controller'
import { API_VERSION } from '@/version'
import { versioningController } from '@/versioning/versioning.controller'
import { webhooksController } from '@/webhooks/webhooks.controller'

function isLocalHttpOrigin(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
  )
}

function normalizeConfiguredOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/$/, '')
  if (trimmed === '*' || trimmed === 'null') {
    throw new Error(`Invalid CORS origin '${origin}'`)
  }
  const parsed = new URL(trimmed)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Invalid CORS origin '${origin}'`)
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`CORS origin must not include path, query, or hash: '${origin}'`)
  }
  if (parsed.protocol === 'http:' && !isLocalHttpOrigin(parsed)) {
    throw new Error(`HTTP CORS origin is only allowed for local development: '${origin}'`)
  }
  return parsed.origin
}

function parseCorsAllowedOrigins(raw: string | undefined, defaults: string[] = []): Set<string> {
  if (!raw) return new Set(defaults)
  const parsed = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => normalizeConfiguredOrigin(origin))
  return new Set(parsed.length > 0 ? parsed : defaults)
}

const CORS_ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
const CORS_ALLOWED_HEADERS = 'Content-Type,Authorization,X-CSRF-Token'
const CORS_MAX_AGE_SECONDS = '86400'
const CORS_PREFLIGHT_CACHE_CONTROL = `public, max-age=${CORS_MAX_AGE_SECONDS}`

const typedStartupEnv = (env as Partial<Env> | undefined) ?? {}

const startupBaseUrlOrigin = typedStartupEnv.BASE_URL
  ? normalizeConfiguredOrigin(typedStartupEnv.BASE_URL)
  : undefined
const startupAdminCorsAllowedOrigins = parseCorsAllowedOrigins(
  typedStartupEnv.ADMIN_CORS_ALLOWED_ORIGINS ?? typedStartupEnv.CORS_ALLOWED_ORIGINS,
  ['http://localhost:5173', ...(startupBaseUrlOrigin ? [startupBaseUrlOrigin] : [])]
)
const startupPublicCorsAllowedOrigins = parseCorsAllowedOrigins(
  typedStartupEnv.PUBLIC_CORS_ALLOWED_ORIGINS,
  []
)
const startupHstsHeader = buildHstsHeader(typedStartupEnv)

function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim()
  try {
    return new URL(trimmed).origin
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

const MAX_PARSED_ORIGINS_CACHE_SIZE = 500
const parsedOriginsCache = new Map<string, Set<string>>()

export function __resetParsedOriginsCacheForTests(): void {
  parsedOriginsCache.clear()
}

function getParsedOrigins(configured: string): Set<string> {
  let cached = parsedOriginsCache.get(configured)
  if (cached) {
    parsedOriginsCache.delete(configured)
    parsedOriginsCache.set(configured, cached)
    return cached
  }

  const set = new Set<string>()
  const origins = configured.split(',').map((o) => o.trim()).filter(Boolean)
  for (const item of origins) {
    set.add(normalizeOrigin(item))
  }
  if (parsedOriginsCache.size >= MAX_PARSED_ORIGINS_CACHE_SIZE) {
    const oldestKey = parsedOriginsCache.keys().next().value
    if (oldestKey) parsedOriginsCache.delete(oldestKey)
  }
  parsedOriginsCache.set(configured, set)
  return set
}

function matchesConfiguredCorsOrigin(configured: string, candidateOrigin: string): boolean {
  const normalizedCandidate = normalizeOrigin(candidateOrigin)
  return getParsedOrigins(configured).has(normalizedCandidate)
}

type MutableHeaders = Record<string, string | number>
type CorsSurface = 'admin' | 'public' | 'none'

function applyApiSecurityHeaders(headers: MutableHeaders, pathname: string) {
  headers['X-Content-Type-Options'] = 'nosniff'
  headers['X-Frame-Options'] = 'DENY'
  headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
  headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
  if (pathname.startsWith('/api/')) {
    headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
  }
}

const TENANT_ADMIN_CORS_REGEX = /^\/api\/tenants\/[^/]+\/api\/admin(?:\/|$)/
const TENANT_PUBLIC_CORS_REGEX = /^\/api\/tenants\/[^/]+\/api\/public(?:\/|$)/

export function classifyCorsSurface(pathname: string): CorsSurface {
  const normalizedPathname = normalizeTenantScopedPath(pathname)
  if (
    normalizedPathname === '/api/me' ||
    normalizedPathname === '/api/csrf' ||
    normalizedPathname === '/api/docs' ||
    normalizedPathname === '/api/bootstrap' ||
    normalizedPathname.startsWith('/api/bootstrap/') ||
    normalizedPathname === '/api/auth' ||
    normalizedPathname.startsWith('/api/auth/') ||
    normalizedPathname === '/api/admin' ||
    normalizedPathname.startsWith('/api/admin/') ||
    TENANT_ADMIN_CORS_REGEX.test(normalizedPathname)
  ) {
    return 'admin'
  }
  if (
    normalizedPathname === '/api/public' ||
    normalizedPathname.startsWith('/api/public/') ||
    TENANT_PUBLIC_CORS_REGEX.test(normalizedPathname)
  ) {
    return 'public'
  }
  return 'none'
}

async function resolveAllowedCorsOrigin(request: Request, pathname: string): Promise<string | null> {
  const origin = request.headers.get('origin')
  if (!origin) return null
  const normalizedOrigin = normalizeOrigin(origin)
  const corsSurface = classifyCorsSurface(pathname)
  if (corsSurface === 'none') return null

  if (corsSurface === 'admin') {
    return startupAdminCorsAllowedOrigins.has(normalizedOrigin) ? origin : null
  }

  const tenantSlug = extractTenantSlug(pathname)

  if (tenantSlug) {
    const corsOrigin = await getCachedCorsOrigin(tenantSlug, async (slug) => {
      const db = createDb((env as Env).DB)
      const tenantResult = await tenantsService.findByIdOrSlug(db, slug)
      return tenantResult.success ? (tenantResult.data.corsOrigin ?? null) : null
    })

    if (corsOrigin) {
      return matchesConfiguredCorsOrigin(corsOrigin, origin) ? origin : null
    }
  }

  return startupPublicCorsAllowedOrigins.has(normalizedOrigin) ? origin : null
}

function setCorsHeaders(headers: MutableHeaders, origin: string) {
  headers['Access-Control-Allow-Origin'] = origin
  headers['Access-Control-Allow-Credentials'] = 'true'
  headers['Access-Control-Allow-Methods'] = CORS_ALLOWED_METHODS
  headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS
  headers['Access-Control-Max-Age'] = CORS_MAX_AGE_SECONDS
  headers['Cache-Control'] = CORS_PREFLIGHT_CACHE_CONTROL
  headers.Vary = 'Origin,Access-Control-Request-Method,Access-Control-Request-Headers'
}

function toResponseHeaders(headers: MutableHeaders): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key in headers) {
    result[key] = String(headers[key])
  }
  return result
}

function buildHstsHeader(config: Partial<Env>): string | undefined {
  const rawMaxAge = config.HSTS_MAX_AGE_SECONDS
  if (!rawMaxAge) return undefined
  const maxAge = Number.parseInt(rawMaxAge, 10)
  if (!Number.isFinite(maxAge) || maxAge < 0) {
    throw new Error('HSTS_MAX_AGE_SECONDS must be a non-negative integer')
  }
  const includeSubDomains = parseBooleanEnv(config.HSTS_INCLUDE_SUBDOMAINS)
  const preload = parseBooleanEnv(config.HSTS_PRELOAD)
  if (preload && (!includeSubDomains || maxAge < 31_536_000)) {
    throw new Error(
      'HSTS_PRELOAD requires HSTS_INCLUDE_SUBDOMAINS=true and HSTS_MAX_AGE_SECONDS >= 31536000'
    )
  }
  return [
    `max-age=${maxAge}`,
    includeSubDomains ? 'includeSubDomains' : undefined,
    preload ? 'preload' : undefined,
  ]
    .filter(Boolean)
    .join('; ')
}

function parseBooleanEnv(raw: string | undefined): boolean {
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function createErrorEnvelope(code: string, message: string, details?: unknown) {
  return {
    success: false as const,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  }
}

function toHttpErrorStatus(status: unknown): number {
  if (typeof status !== 'number' || !Number.isInteger(status)) return 500
  if (status < 400 || status > 599) return 500
  return status
}

function mapStatusToErrorCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST'
    case 401:
      return 'UNAUTHORIZED'
    case 403:
      return 'FORBIDDEN'
    case 404:
      return 'NOT_FOUND'
    case 405:
      return 'METHOD_NOT_ALLOWED'
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE'
    case 422:
      return 'VALIDATION_ERROR'
    case 429:
      return 'RATE_LIMITED'
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'
  }
}

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

export type CreateAppOptions = {
  pluginRegistry?: PluginRegistry
  pluginRuntime?: PluginRuntime
  metricSink?: MetricSink
  metricsRegistry?: MetricsRegistry
}

export const createApp = (options: CreateAppOptions = {}) => {
  const metricsRegistry =
    options.metricsRegistry ??
    (options.metricSink ? createMetricsRegistry(options.metricSink) : defaultMetricsRegistry)
  const pluginRt =
    options.pluginRuntime ??
    (options.pluginRegistry ? getPluginRuntimeForRegistry(options.pluginRegistry) : undefined)
  const scopedPluginsController = pluginRt ? createPluginsController(pluginRt) : pluginsController
  const scopedPluginRoutesController = pluginRt
    ? pluginRt.createLoadedPluginRoutesController()
    : createLoadedPluginRoutesController()

  return applyTenantPathAliases(
    applyPublicAssetFormatAliases(
      new Elysia({ adapter: CloudflareAdapter, aot: false, normalize: 'typebox' })
      .onRequest(({ request, set }) => {
        const url = getRequestUrl(request)
        const pathname = url.pathname
        const headers = set.headers as MutableHeaders
        applyApiSecurityHeaders(headers, pathname)
        if (startupHstsHeader && url.protocol === 'https:') {
          headers['Strict-Transport-Security'] = startupHstsHeader
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
      .derive({ as: 'global' }, ({ request }) => {
        const url = getRequestUrl(request)
        return { 
          requestId: getOrCreateRequestId(request),
          requestMetrics: createRequestMetrics(),
          metrics: metricsRegistry,
          parsedUrl: url,
          pathname: url.pathname,
        }
      })
      .onAfterHandle({ as: 'global' }, (ctx) => {
        const pathname = (ctx as { pathname?: string }).pathname ?? getRequestPathname(ctx.request)
        const requestId = ctx.requestId ?? getOrCreateRequestId(ctx.request)
        
        // Flush per-request metrics in batch
        ctx.requestMetrics?.flush((name: string, labels: Record<string, string>, _value: number) => {
          metricsRegistry.increment(name, labels)
        })
        
        metricsRegistry.increment('http_requests_total', {
          method: ctx.request.method,
          path: pathname,
          status: String(ctx.set.status ?? 200),
        })
        setRequestIdHeader(ctx.set, requestId)

        // Set W3C traceparent header for distributed tracing
        const traceparent = createTraceparentHeader(requestId)
        const headers = ctx.set.headers as MutableHeaders
        headers['traceparent'] = traceparent

        logger.info('request_completed', {
          method: ctx.request.method,
          path: pathname,
          status: String(ctx.set.status ?? 200),
          requestId,
        })

        // API version header
        headers['X-API-Version'] = API_VERSION

        // Security headers
        applyApiSecurityHeaders(headers, pathname)
        const url = (ctx as { parsedUrl?: URL }).parsedUrl ?? getRequestUrl(ctx.request)
        if (startupHstsHeader && url.protocol === 'https:') {
          headers['Strict-Transport-Security'] = startupHstsHeader
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
      .onBeforeHandle(async (ctx) => {
        const pathname = (ctx as { pathname?: string }).pathname ?? getRequestPathname(ctx.request)
        const allowedOrigin = await resolveAllowedCorsOrigin(ctx.request, pathname)
        if (allowedOrigin) {
          setCorsHeaders(ctx.set.headers as MutableHeaders, allowedOrigin)
        }

        const method = ctx.request.method
        const tenantSlug = extractTenantSlug(pathname)
        const typedEnv = env as Env
        const shouldCheckAuthorization = requiresAuthorizationCheck(pathname, method)

        if (shouldCheckAuthorization) {
          const jwtValidation = await validateRequestJwt(ctx.request, {
            secret: typedEnv.JWT_HS256_SECRET,
            issuer: typedEnv.JWT_ISSUER,
            audience: typedEnv.JWT_AUDIENCE,
            required: parseBooleanEnv(typedEnv.JWT_REQUIRED_FOR_ADMIN),
          })
          if (!jwtValidation.valid) {
            ctx.set.status = 401
            return {
              success: false as const,
              error: { code: jwtValidation.code, message: jwtValidation.message },
            }
          }
        }

        let actorId: string | undefined
        let actorRole: ActorRole | undefined
        let actorSessionRoleRaw: string | undefined
        let actorUserRoleRaw: string | undefined
        let actorEmail: string | undefined
        if (shouldResolveActorSession(pathname, method)) {
          try {
            const actor = await resolveActorSessionDetails(ctx.request)
            actorId = actor.actorId
            actorRole = actor.actorRole
            actorSessionRoleRaw = actor.actorSessionRoleRaw
            actorUserRoleRaw = actor.actorUserRoleRaw
            actorEmail = actor.actorEmail
          } catch (err) {
            logger.warn('actor_session_resolution_failed', { error: err instanceof Error ? err.message : String(err) })
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
            }
          )
          if (!rate.allowed) {
            ctx.set.status = 429
            return {
              success: false as const,
              error: { code: 'RATE_LIMITED', message: 'Too many requests' },
            }
          }
        }

        if (
          requiresCsrf(pathname, method) &&
          !(await validateCsrfToken(ctx.request, typedEnv.BETTER_AUTH_SECRET!))
        ) {
          ctx.set.status = 403
          return {
            success: false as const,
            error: { code: 'CSRF_REQUIRED', message: 'Invalid or missing CSRF token' },
          }
        }

        if (shouldCheckAuthorization) {
          const superAdminEmails = parseSuperAdminEmails(typedEnv.SUPER_ADMIN_EMAILS)
          let tenantId: string | undefined
          let tenantRole: TenantActorRole | undefined
          if (actorId && tenantSlug) {
            const db = createDb(typedEnv.DB)
            const tenantResult = await tenantsService.findByIdOrSlug(db, tenantSlug)
            tenantId = tenantResult.success ? tenantResult.data.id : undefined
            tenantRole = await resolveTenantRoleForActor(typedEnv.DB, actorId, tenantSlug)
          }

          // Fetch custom permissions from database if tenant role exists
          let customPermissions: import('@/auth/authorization').DbPermission[] | undefined
          if (tenantId && tenantRole) {
            const db = createDb(typedEnv.DB)
            const permissionsResult = await rbacService.getEffectivePermissions(db, tenantId, tenantRole)
            if (permissionsResult.success) {
              customPermissions = permissionsResult.data
            }
          }

          const authorization = authorizeApiRequest({
            pathname,
            method,
            principal: {
              actorId,
              actorRole,
              tenantRole,
              isSuperAdmin:
                hasSuperAdminRole(actorSessionRoleRaw) || hasSuperAdminRole(actorUserRoleRaw),
              isSuperAdminByEmail: isSuperAdminEmail(actorEmail, superAdminEmails),
            },
            customPermissions,
          })
          if (!authorization.allowed) {
            ctx.set.status = authorization.status
            return {
              success: false as const,
              error: { code: authorization.code, message: authorization.message },
            }
          }
        }

      })
      .use(
        openapi({
          path: '/api/docs',
          documentation: {
            info: {
              title: 'EdgeCMS API',
              version: API_VERSION,
              description:
                'Content Management System API powered by ElysiaJS on Cloudflare Workers',
            },
          },
        })
      )
      .use(betterAuthPlugin)
      .get('/api/csrf', async ({ request, set }) => {
        const token = await createSignedCsrfToken((env as Env).BETTER_AUTH_SECRET!)
        ;(set.headers as MutableHeaders)['Set-Cookie'] = formatCsrfCookieHeader(token, {
          secure: getRequestUrl(request).protocol === 'https:',
        })
        return { success: true as const, data: { csrfToken: token } }
      })

      // Global admin routes — tenant management (super-admin)
      .use(tenantsController)

      // Global routes (backward compatibility for single-tenant deployments)
      .use(publicController)
      .use(assetsController)
      .use(aiController)
      .use(collectionsController)
      .use(commandsController)
      .use(entriesController)
      .use(scopedPluginsController)
      .use(scopedPluginRoutesController)
      .use(relationsController)
      .use(syncController)
      .use(usersController)
      .use(versioningController)
      .use(cacheStatsController)
      .use(systemController)
      .use(webhooksController)
      .use(mcpController)

      // Tenant-scoped routes — apply tenant middleware to resolve tenant context
      .group('/api/tenants/:tenantSlug', (app) =>
        app
          .use(tenantMiddleware)
          // Tenant-scoped admin routes
          .use(aiController)
          .use(mcpController)
          .use(collectionsController)
          .use(commandsController)
          .use(entriesController)
          .use(scopedPluginsController)
          .use(scopedPluginRoutesController)
          .use(relationsController)
          .use(syncController)
          .use(usersController)
          .use(versioningController)
          .use(cacheStatsController)
          .use(systemController)
          .use(webhooksController)
          .use(rbacController)
          .use(assetsController)
          // Tenant-scoped public routes
          .use(publicController)
      )

      .get('/api', async () => buildHealthStatus())
      .get('/api/health', async () => buildHealthStatus())
      .get('/api/health/live', () => ({ status: 'ok' as const }))
      .get('/api/bootstrap/status', async () => {
        const typedEnv = env as Env
        try {
          const db = createDb(typedEnv.DB)
          const userCount = await usersRepository.countAll(db)

          return {
            needsOnboarding: userCount === 0,
            userCount,
          }
        } catch {
          return {
            needsOnboarding: true,
            userCount: 0,
          }
        }
      })
      .post(
        '/api/bootstrap/provision-tenant',
        async ({ user, set }) => {
          const db = createDb((env as Env).DB)
          const result = await ensureUserHasOnboardingTenant(db, {
            id: user.id,
            name: user.name,
            email: user.email,
          })
          if (!result.success) {
            set.status = result.error.code === 'CONFLICT' ? 409 : 400
            return { success: false as const, error: result.error }
          }
          set.status = 201
          return { success: true as const, data: result.data }
        },
        { auth: true }
      )
      .get(
        '/api/me',
        ({ user }) => {
          const typedEnv = env as Env
          const rawRole = (user as { role?: unknown }).role
          const role =
            hasSuperAdminRole(rawRole) ||
            isSuperAdminEmail(user.email, parseSuperAdminEmails(typedEnv.SUPER_ADMIN_EMAILS))
              ? 'superadmin'
              : typeof rawRole === 'string'
                ? rawRole
                : 'viewer'

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role,
          }
        },
        { auth: true }
      )
      .onError(({ code, error, set }) => {
        if (code === 'VALIDATION') {
          set.status = 422
          return createErrorEnvelope('VALIDATION_ERROR', 'Request validation failed')
        }
        if (code === 'NOT_FOUND') {
          set.status = 404
          return createErrorEnvelope('NOT_FOUND', 'Route not found')
        }

        const status = toHttpErrorStatus(set.status)
        set.status = status
        const message =
          status >= 500
            ? 'Internal server error'
            : error instanceof Error
              ? error.message
              : 'Request failed'

        return createErrorEnvelope(mapStatusToErrorCode(status), message)
      })
    )
  )
}

const startupEnv = (env ?? {}) as Partial<Env>
const configuredPluginHookTimeoutMs = parsePluginHookTimeoutMs(startupEnv.EDGE_PLUGIN_HOOK_TIMEOUT_MS)
if (configuredPluginHookTimeoutMs !== undefined) {
  pluginRegistry.setHookTimeoutMs(configuredPluginHookTimeoutMs)
}
if (startupEnv.EDGE_PLUGINS_JSON) {
  await reloadConfiguredPlugins(startupEnv.EDGE_PLUGINS_JSON, pluginRegistry, {
    kv: startupEnv.CACHE,
  })
}

let hasWarmedCache = false

export function resetPublicCacheWarmingState(): void {
  hasWarmedCache = false
}

export function warmPublicCacheInBackground(workerEnv?: Env, executionCtx?: ExecutionContext): void {
  if (hasWarmedCache) return
  hasWarmedCache = true

  const targetEnv = (workerEnv ?? env) as Env
  const hasWarmableBindings =
    !!targetEnv.CACHE &&
    typeof targetEnv.CACHE.get === 'function' &&
    typeof targetEnv.CACHE.put === 'function' &&
    !!targetEnv.DB &&
    typeof targetEnv.DB.prepare === 'function'

  if (!hasWarmableBindings) {
    if (targetEnv.CACHE && targetEnv.DB) {
      logger.warn('public_cache_warming_skipped_missing_bindings', {
        hasDbPrepare: typeof (targetEnv.DB as unknown as { prepare?: unknown }).prepare === 'function',
        hasKvGet: typeof (targetEnv.CACHE as unknown as { get?: unknown }).get === 'function',
        hasKvPut: typeof (targetEnv.CACHE as unknown as { put?: unknown }).put === 'function',
      })
    }
    return
  }

  const promise = warmPublicCache({
    db: createDb(targetEnv.DB),
    kv: targetEnv.CACHE,
    getCollections: async (db) => {
      const rows = await collectionsRepository.findAll(db)
      return rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        singleton: c.singleton,
        defaultLocale: c.defaultLocale ?? 'en',
      }))
    },
    getCollectionList: (p) => publicService.getCollectionList(p),
    getSingletonEntry: (p) => publicService.getSingletonEntry(p),
  }).catch((err) => {
    logger.warn('public_cache_warming_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  })

  if (executionCtx && typeof executionCtx.waitUntil === 'function') {
    executionCtx.waitUntil(promise)
  }
}

export type App = ReturnType<typeof createApp>
