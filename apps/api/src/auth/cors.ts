import { env } from 'cloudflare:workers'
import type { Env } from '@/env'
import { parseBooleanEnv } from '@/shared/utils/env-flags'
import { createDb } from '@/database/db'
import { tenantsService } from '@/tenants/tenants.service'
import { getCachedCorsOrigin } from '@/tenants/cors-cache'
import { extractTenantSlug } from '@/tenants/tenant-path'
import { normalizeTenantScopedPath } from '@/tenants/tenant-path-normalizer'

export type MutableHeaders = Record<string, string | number>
export type CorsSurface = 'admin' | 'public' | 'none'

export function isLocalHttpOrigin(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
  )
}

export function normalizeConfiguredOrigin(origin: string): string {
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

export function parseCorsAllowedOrigins(raw: string | undefined, defaults: string[] = []): Set<string> {
  if (!raw) return new Set(defaults)
  const parsed = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => normalizeConfiguredOrigin(origin))
  return new Set(parsed.length > 0 ? parsed : defaults)
}

export const CORS_ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
export const CORS_ALLOWED_HEADERS = 'Content-Type,Authorization,X-CSRF-Token'
export const CORS_EXPOSED_HEADERS = 'x-d1-session'
export const CORS_MAX_AGE_SECONDS = '86400'
export const CORS_PREFLIGHT_CACHE_CONTROL = `public, max-age=${CORS_MAX_AGE_SECONDS}`

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

export function normalizeOrigin(origin: string): string {
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

export function getParsedOrigins(configured: string): Set<string> {
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

export function matchesConfiguredCorsOrigin(configured: string, candidateOrigin: string): boolean {
  const normalizedCandidate = normalizeOrigin(candidateOrigin)
  return getParsedOrigins(configured).has(normalizedCandidate)
}

export function isGraphQLEndpoint(pathname: string): boolean {
  return (
    pathname === '/api/graphql' ||
    pathname.startsWith('/api/graphql/') ||
    /^\/api\/tenants\/[^/]+\/api\/graphql(?:\/|$)/.test(pathname) ||
    /^\/api\/tenants\/[^/]+\/graphql(?:\/|$)/.test(pathname)
  )
}

export function applyApiSecurityHeaders(headers: MutableHeaders, pathname: string): void {
  headers['X-Content-Type-Options'] = 'nosniff'
  headers['X-Frame-Options'] = 'DENY'
  headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
  headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
  if (pathname.startsWith('/api/')) {
    if (isGraphQLEndpoint(pathname)) {
      headers['Content-Security-Policy'] =
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://unpkg.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com; frame-ancestors 'none'"
    } else {
      headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
    }
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
    normalizedPathname === '/api/graphql' ||
    normalizedPathname.startsWith('/api/graphql/') ||
    TENANT_PUBLIC_CORS_REGEX.test(normalizedPathname) ||
    /^\/api\/tenants\/[^/]+\/api\/graphql(?:\/|$)/.test(normalizedPathname)
  ) {
    return 'public'
  }
  return 'none'
}

export async function resolveAllowedCorsOrigin(
  request: Request,
  pathname: string,
  options?: { adminOrigins?: Set<string>; publicOrigins?: Set<string> }
): Promise<string | null> {
  const origin = request.headers.get('origin')
  if (!origin) return null
  const normalizedOrigin = normalizeOrigin(origin)
  const corsSurface = classifyCorsSurface(pathname)
  if (corsSurface === 'none') return null

  const adminOrigins = options?.adminOrigins ?? startupAdminCorsAllowedOrigins
  const publicOrigins = options?.publicOrigins ?? startupPublicCorsAllowedOrigins

  if (corsSurface === 'admin') {
    return adminOrigins.has(normalizedOrigin) ? origin : null
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

  return publicOrigins.has(normalizedOrigin) ? origin : null
}

export function setCorsHeaders(headers: MutableHeaders, origin: string): void {
  headers['Access-Control-Allow-Origin'] = origin
  headers['Access-Control-Allow-Credentials'] = 'true'
  headers['Access-Control-Allow-Methods'] = CORS_ALLOWED_METHODS
  headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS
  headers['Access-Control-Expose-Headers'] = CORS_EXPOSED_HEADERS
  headers['Access-Control-Max-Age'] = CORS_MAX_AGE_SECONDS
  headers['Cache-Control'] = CORS_PREFLIGHT_CACHE_CONTROL
  headers.Vary = 'Origin,Access-Control-Request-Method,Access-Control-Request-Headers'
}

export function toResponseHeaders(headers: MutableHeaders): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key in headers) {
    result[key] = String(headers[key])
  }
  return result
}

export { parseBooleanEnv }

export function buildHstsHeader(config: Partial<Env>): string | undefined {
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
