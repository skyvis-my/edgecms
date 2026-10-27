import { env } from 'cloudflare:workers'
import { openapi } from '@elysia/openapi'
import { Elysia } from 'elysia'
import { warmPublicCache } from '@/cache/cache-warming'
import { betterAuthPlugin, handleBetterAuth } from '@/auth/auth.middleware'
import {
  ACCESS_TOKEN_DEFAULT_TTL_SECONDS,
  createAccessToken,
} from '@/auth/jwt'
import {
  getAuthRevision,
  getPermissionRevision,
} from '@/auth/auth-revision'
import { resolveActorSessionDetails, resolveTenantRoleForActor } from '@/auth/rbac'
import {
  createSignedCsrfToken,
  formatCsrfCookieHeader,
} from '@/auth/csrf.middleware'
import { rbacController } from '@/auth/rbac.controller'
import { auditTrailPlugin } from '@/audit/audit-trail.plugin'
import { privacyController } from '@/privacy/privacy.controller'
import { configureAuthPolicies } from '@/auth/auth-policies'
import {
  isMfaVerifiedSession,
  MFA_REQUIRED_CODE,
  MFA_REQUIRED_MESSAGE,
  isSuperAdminMissingMfa,
} from '@/auth/mfa'
import {
  hasSuperAdminRole,
  isSuperAdminEmail,
  isSuperAdminUser,
  parseSuperAdminEmails,
} from '@/auth/super-admin'
import { ensureUserHasOnboardingTenant } from '@/bootstrap/onboarding-tenant'
import { createErrorEnvelope, toServiceResponse } from '@/shared/utils/service-response'
import { collectionsRepository } from '@/collections/collections.repository'
import { createDb } from '@/database/db'
import type { Env } from '@/env'
import { buildHealthStatus } from '@/health'
import {
  createMetricsRegistry,
  defaultMetricsRegistry,
  type MetricSink,
  type MetricsRegistry,
} from '@/observability/metrics'
import { logger } from '@/observability/logger'
import { getRequestUrl } from '@/shared/utils/request-url'
import {
  createLoadedPluginRoutesController,
  getPluginRuntimeForRegistry,
  type PluginRuntime,
  reloadConfiguredPlugins,
} from '@/plugins/plugin-loader'
import { type PluginRegistry, pluginRegistry } from '@/plugins/plugin-registry'
import { parsePluginHookTimeoutMs } from '@/runtime/bootstrap'
import { createPluginsController, pluginsController } from '@/plugins/plugins.controller'
import { publicService } from '@/public/public.service'
import { applyPublicAssetFormatAliases } from '@/public/public-assets-path-normalizer'
import { tenantMiddleware } from '@/tenants/tenant.middleware'
import { tenantsService } from '@/tenants/tenants.service'
import { applyTenantPathAliases } from '@/tenants/tenant-path-normalizer'
import { createTenantsController } from '@/tenants/tenants.controller'
import { type HostPolicies, resolveHostPolicies } from '@/host/host-policies'
import { createTenantEventPublisher } from '@/host/tenant-events'
import { invitesController } from '@/invites/invites.controller'
import { createHostRuntime, createHostRuntimePlugin } from '@/host/host-context'
import { createTenantRateLimitResolver } from '@/host/rate-limits'
import { usersRepository } from '@/users/users.repository'
import { API_VERSION } from '@/version'
import {
  buildHstsHeader,
  normalizeConfiguredOrigin,
  parseCorsAllowedOrigins,
  resolveAllowedCorsOrigin as resolveAllowedCorsOriginBase,
  type MutableHeaders,
} from '@/auth/cors'
import { createApiSecurityGuardPlugin } from '@/auth/api-security.plugin'
import { createRequestObservabilityPlugin } from '@/observability/request-observability.plugin'
import { createCoreApiRoutes } from '@/routes/core-routes'

export {
  __resetParsedOriginsCacheForTests,
  applyApiSecurityHeaders,
  buildHstsHeader,
  classifyCorsSurface,
  CORS_EXPOSED_HEADERS,
  getParsedOrigins,
  isGraphQLEndpoint,
  isLocalHttpOrigin,
  matchesConfiguredCorsOrigin,
  normalizeConfiguredOrigin,
  normalizeOrigin,
  parseBooleanEnv,
  parseCorsAllowedOrigins,
  setCorsHeaders,
  toResponseHeaders,
} from '@/auth/cors'

const typedStartupEnv = (env as Partial<Env> | undefined) ?? {}

const startupBaseUrlOrigin = typedStartupEnv.BASE_URL
  ? normalizeConfiguredOrigin(typedStartupEnv.BASE_URL)
  : undefined
export const startupAdminCorsAllowedOrigins = parseCorsAllowedOrigins(
  typedStartupEnv.ADMIN_CORS_ALLOWED_ORIGINS ?? typedStartupEnv.CORS_ALLOWED_ORIGINS,
  ['http://localhost:5173', ...(startupBaseUrlOrigin ? [startupBaseUrlOrigin] : [])]
)
export const startupPublicCorsAllowedOrigins = parseCorsAllowedOrigins(
  typedStartupEnv.PUBLIC_CORS_ALLOWED_ORIGINS,
  []
)
export const startupHstsHeader = buildHstsHeader(typedStartupEnv)

export async function resolveAllowedCorsOrigin(request: Request, pathname: string): Promise<string | null> {
  return resolveAllowedCorsOriginBase(request, pathname, {
    adminOrigins: startupAdminCorsAllowedOrigins,
    publicOrigins: startupPublicCorsAllowedOrigins,
  })
}

export function toHttpErrorStatus(status: unknown): number {
  if (typeof status !== 'number' || !Number.isInteger(status)) return 500
  if (status < 400 || status > 599) return 500
  return status
}

export function mapStatusToErrorCode(status: number): string {
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

export type CreateAppOptions = {
  pluginRegistry?: PluginRegistry
  pluginRuntime?: PluginRuntime
  metricSink?: MetricSink
  metricsRegistry?: MetricsRegistry
  /**
   * Host policies (PRD §10.1). Configured at composition time, owned by this
   * app instance. Omitted hooks keep the framework defaults.
   */
  host?: HostPolicies
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

  const host = resolveHostPolicies(options.host)
  if (options.host?.auth) configureAuthPolicies(options.host.auth)
  const tenantEvents = createTenantEventPublisher(host)
  const hostRuntime = createHostRuntime(host, tenantEvents)
  const scopedTenantsController = createTenantsController({
    host,
    events: tenantEvents,
    limits: hostRuntime.limits,
  })

  const coreRoutes = createCoreApiRoutes({
    scopedPluginsController,
    scopedPluginRoutesController,
  })

  const securityPlugin = createApiSecurityGuardPlugin({
    hstsHeader: startupHstsHeader,
    resolveAllowedCorsOrigin,
    resolveTenantRateLimit: createTenantRateLimitResolver(host.rateLimits),
  })

  const observabilityPlugin = createRequestObservabilityPlugin({
    metricsRegistry,
    hstsHeader: startupHstsHeader,
  })

  return applyTenantPathAliases(
    applyPublicAssetFormatAliases(
      new Elysia()
        .use(createHostRuntimePlugin(hostRuntime))
        .use(securityPlugin)
        .use(observabilityPlugin)
        .use(auditTrailPlugin)
        .onAfterHandle('global', (ctx) => {
          const db = (ctx as { db?: any }).db
          const bookmark =
            typeof db?.$client?.getBookmark === 'function'
              ? db.$client.getBookmark()
              : typeof (db as any)?.getBookmark === 'function'
                ? (db as any).getBookmark()
                : undefined
          if (bookmark && typeof bookmark === 'string') {
            ;(ctx.set.headers as Record<string, string>)['x-d1-session'] = bookmark
            const res = (ctx as { response?: unknown }).response
            if (res instanceof Response) {
              try {
                res.headers.set('x-d1-session', bookmark)
              } catch {}
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
        // Better Auth reads the raw body itself; parsing it here would consume
        // the stream and break every POST to /api/auth on workerd.
        .all('/api/auth', { parse: 'none' }, ({ request }) => handleBetterAuth(request))
        .all('/api/auth/*', { parse: 'none' }, ({ request }) => handleBetterAuth(request))
        .get('/api/csrf', async ({ request, set }) => {
          const token = await createSignedCsrfToken((env as Env).BETTER_AUTH_SECRET!)
          ;(set.headers as MutableHeaders)['Set-Cookie'] = formatCsrfCookieHeader(token, {
            secure: getRequestUrl(request).protocol === 'https:',
          })
          return { success: true as const, data: { csrfToken: token } }
        })
        .get('/api/auth/access-token', { auth: true }, async ({ request, query, set }) => {
          const typedEnv = env as Env
          if (!typedEnv.JWT_HS256_SECRET) {
            set.status = 500
            return createErrorEnvelope('CONFIG_ERROR', 'Access tokens are not configured')
          }
          const rawTenant = (query as { tenant?: unknown } | undefined)?.tenant
          const tenantSlug = typeof rawTenant === 'string' && rawTenant ? rawTenant : undefined

          const actor = await resolveActorSessionDetails(request)
          if (!actor.actorId) {
            set.status = 401
            return createErrorEnvelope('UNAUTHORIZED', 'Authentication required')
          }

          let tid: string | undefined
          let tsl: string | undefined
          let trl: string | undefined
          let rv = 0
          let pv = 0
          let tenantRequiresMfa = false
          if (tenantSlug) {
            const db = createDb(typedEnv.DB)
            const tenantResult = await tenantsService.findByIdOrSlug(db, tenantSlug)
            if (!tenantResult.success) {
              set.status = 404
              return createErrorEnvelope('NOT_FOUND', `Tenant '${tenantSlug}' not found`)
            }
            tid = tenantResult.data.id
            tsl = tenantResult.data.slug
            tenantRequiresMfa = tenantResult.data.requireMfa === true
            trl = await resolveTenantRoleForActor(typedEnv.DB, actor.actorId, tsl)
            if (!trl) {
              set.status = 403
              return createErrorEnvelope('FORBIDDEN', 'Tenant membership required')
            }
            rv = (await getAuthRevision(typedEnv.CACHE, actor.actorId, tid)) ?? 0
            pv = (await getPermissionRevision(typedEnv.CACHE, tid)) ?? 0
          }

          // HS-11: never mint a token that would let a caller skip a required
          // second factor. Changing a tenant's requirement bumps its permission
          // revision, so older tokens go stale.
          const mfaVerified = actor.mfaVerified === true
          const superAdminMissingMfa = isSuperAdminMissingMfa(
            {
              email: actor.actorEmail,
              emailVerified: actor.actorEmailVerified === true,
              userRole: actor.actorUserRoleRaw,
              sessionRole: actor.actorSessionRoleRaw,
              mfaVerified,
            },
            typedEnv
          )
          if (superAdminMissingMfa || (tenantRequiresMfa && !mfaVerified)) {
            set.status = 403
            return createErrorEnvelope(MFA_REQUIRED_CODE, MFA_REQUIRED_MESSAGE)
          }

          const issuedAt = Math.floor(Date.now() / 1000)
          const token = await createAccessToken(
            {
              sub: actor.actorId,
              role: actor.actorRole,
              tid,
              tsl,
              trl,
              rv,
              pv,
              email: actor.actorEmail,
              emailVerified: actor.actorEmailVerified === true,
              sa:
                hasSuperAdminRole(actor.actorSessionRoleRaw) ||
                hasSuperAdminRole(actor.actorUserRoleRaw),
              mfa: actor.mfaVerified === true,
            },
            typedEnv.JWT_HS256_SECRET,
            {
              issuer: typedEnv.JWT_ISSUER,
              audience: typedEnv.JWT_AUDIENCE,
              ttlSeconds: ACCESS_TOKEN_DEFAULT_TTL_SECONDS,
              issuedAtSeconds: issuedAt,
            }
          )
          return {
            success: true as const,
            data: {
              token,
              expiresAt: new Date(
                (issuedAt + ACCESS_TOKEN_DEFAULT_TTL_SECONDS) * 1000
              ).toISOString(),
            },
          }
        })

        // Global admin routes — tenant management (super-admin)
        .use(scopedTenantsController)
        .use(invitesController)

        // HS-13 personal data requests (global only)
        .use(privacyController)

        // Global routes (backward compatibility for single-tenant deployments)
        .use(coreRoutes)

        // Tenant-scoped routes — apply tenant middleware to resolve tenant context
        .group('/api/tenants/:tenantSlug', (app) =>
          app
            .use(tenantMiddleware)
            .use(rbacController)
            .use(coreRoutes)
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
        .post('/api/bootstrap/provision-tenant', { auth: true }, async ({ user, set }) => {
          const db = createDb((env as Env).DB)
          const result = await ensureUserHasOnboardingTenant(
            db,
            { id: user.id, name: user.name, email: user.email },
            {
              host,
              events: tenantEvents,
              limits: hostRuntime.limits,
              isSuperAdmin: isSuperAdminUser(
                user as { email: string; emailVerified?: boolean; role?: unknown },
                env as Env
              ),
            }
          )
          return toServiceResponse(set, result, { successStatus: 201 })
        })
        .get('/api/me', { auth: true }, ({ user, session }) => {
          const typedEnv = env as Env
          const rawRole = (user as { role?: unknown }).role
          const role =
            hasSuperAdminRole(rawRole) ||
            isSuperAdminEmail(
              user.email,
              parseSuperAdminEmails(typedEnv.SUPER_ADMIN_EMAILS),
              (user as { emailVerified?: unknown }).emailVerified === true
            )
              ? 'superadmin'
              : typeof rawRole === 'string'
                ? rawRole
                : 'viewer'

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role,
            twoFactorEnabled: (user as { twoFactorEnabled?: unknown }).twoFactorEnabled === true,
            mfaVerified: isMfaVerifiedSession({ session }),
          }
        })
        .onError(({ code, error, set, request }) => {
          const requestId =
            (request?.headers?.get?.('x-request-id') as string | undefined) ?? 'unknown'
          logger.error('request_failed', {
            code,
            status: set.status,
            requestId,
            error: error instanceof Error ? error.stack ?? error.message : String(error),
          })
          if (code === 'VALIDATION') {
            set.status = 422
            return createErrorEnvelope('VALIDATION_ERROR', 'Request validation failed')
          }
          if (code === 'NOT_FOUND') {
            set.status = 404
            return createErrorEnvelope('NOT_FOUND', 'Route not found')
          }
          if (code === 'METHOD_NOT_ALLOWED') {
            set.status = 405
            return createErrorEnvelope('METHOD_NOT_ALLOWED', 'Method not allowed')
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

// Re-export runtime bootstrap and lifecycle helpers for standalone consumers
export {
  bootstrapApp,
  parsePluginHookTimeoutMs,
  ensureWorkerBootstrapped,
  resetWorkerBootstrapStateForTests,
  type BootstrapOptions,
  type BootstrapResult,
} from '@/runtime/bootstrap'
export {
  createPluginRuntime,
  type PluginRuntime,
} from '@/plugins/plugin-loader'
export {
  createPluginRegistry,
  type PluginRegistry,
} from '@/plugins/plugin-registry'
export type {
  HostPolicies,
  InitialTenantStatus,
  TenantCreationActor,
  TenantCreationDecision,
  TenantCreationSource,
  TenantEventType,
  TenantLifecycleEvent,
  TenantLimitReached,
  TenantRateLimitPolicy,
  TenantRateLimitRequest,
} from '@/host/host-policies'
export {
  createD1UsageRollupSink,
  noopUsageSink,
  type D1UsageRollupSink,
  type D1UsageRollupSinkOptions,
  type UsageEvent,
  type UsageMetric,
  type UsageSink,
} from '@/host/usage'
export {
  defaultTenantLimits,
  type LimitCheck,
  type LimitDecision,
  type LimitDenial,
  type LimitDimension,
  type LimitTenant,
  type TenantLimits,
} from '@/host/limits'
export type { RateLimitCategory, RateLimitPolicy } from '@/auth/rate-limit.middleware'
export {
  createMetricsRegistry,
  type MetricSink,
  type MetricsRegistry,
} from '@/observability/metrics'
export type { Env } from '@/env'
export {
  configureAuthPolicies,
  createConsoleEmailSender,
  type AuthEmailMessage,
  type AuthEmailSender,
  type AuthPolicies,
  type AuthPolicyOverrides,
  type SignupPolicy,
} from '@/auth/auth-policies'
