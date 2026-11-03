/**
 * OSS / self-host runtime configuration (Docker, Kubernetes, bare Bun).
 * Cloudflare Workers continue to use wrangler bindings; this path is opt-in.
 */

export type DatabaseDriver = 'sqlite' | 'postgres'
export type MediaDriver = 'filesystem' | 's3'
export type CacheDriver = 'memory' | 'redis'

export interface HostingConfig {
  runtime: 'node'
  port: number
  hostname: string
  baseUrl: string
  database: {
    driver: DatabaseDriver
    /** bun:sqlite file path when driver=sqlite */
    sqlitePath: string
    /** postgres connection URL when driver=postgres */
    databaseUrl?: string
    /** Directory of SQL files to apply (sqlite: drizzle/migrations, postgres: drizzle/postgres) */
    migrationsDir: string
  }
  cache: {
    driver: CacheDriver
    redisUrl?: string
  }
  media: {
    driver: MediaDriver
    /** Local directory for filesystem driver */
    dataDir: string
    /** S3-compatible (MinIO, AWS, Alibaba OSS) — write/origin API only */
    endpoint?: string
    region?: string
    bucket?: string
    accessKeyId?: string
    secretAccessKey?: string
    forcePathStyle?: boolean
    /**
     * Public CDN / custom-domain origin (no path). Prefer CDN_BASE_URL over
     * MEDIA_PUBLIC_BASE_URL. Never the raw S3/OSS API endpoint.
     */
    publicBaseUrl?: string
    /** Explicit CDN env when set (also copied onto Env.CDN_BASE_URL). */
    cdnBaseUrl?: string
  }
  adminDistDir: string
  secrets: {
    betterAuthSecret: string
    jwtHs256Secret?: string
  }
  featureFlags: {
    /** Enable Atomic Edge Promote cache warming HTTP (needs reachable BASE_URL). */
    enablePromoteCacheWarming: boolean
    enablePublicCacheWarming: boolean
    enableReleaseSemantic: boolean
    signupPolicy: string
    superAdminEmails: string
    superAdminRequireMfa: boolean
  }
  /** Extra string env vars forwarded onto the Worker-shaped Env. */
  passthrough: Record<string, string>
}

function envFlag(name: string, fallback = false): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes'
}

function requireSecret(name: string, minLen = 32): string {
  const value = process.env[name]?.trim()
  if (!value || value.length < minLen) {
    throw new Error(`${name} must be set and at least ${minLen} characters for the OSS hosting path`)
  }
  return value
}

/**
 * Build a redis:// URL from REDIS_URL or REDIS_HOST (+ optional port/password/db).
 * Returns undefined when neither REDIS_URL nor REDIS_HOST is set (memory fallback).
 */
export function resolveRedisUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const direct = env.REDIS_URL?.trim()
  if (direct) return direct

  const host = env.REDIS_HOST?.trim()
  if (!host) return undefined

  const portRaw = env.REDIS_PORT?.trim()
  const port = portRaw && Number.isFinite(Number(portRaw)) ? Number(portRaw) : 6379
  const password = env.REDIS_PASSWORD?.trim()
  const dbRaw = env.REDIS_DB?.trim()
  const db = dbRaw && Number.isFinite(Number(dbRaw)) ? Number(dbRaw) : undefined

  const auth = password ? `:${encodeURIComponent(password)}@` : ''
  const path = db !== undefined ? `/${db}` : ''
  return `redis://${auth}${host}:${port}${path}`
}

/**
 * Resolve CACHE_DRIVER:
 * - unset + no Redis env → memory (single-replica default)
 * - unset + Redis URL/host → redis (multi-replica convenience)
 * - explicit memory|redis wins; redis requires a resolved URL
 */
export function resolveCacheDriverFromEnv(
  env: NodeJS.ProcessEnv = process.env
): { driver: CacheDriver; redisUrl?: string } {
  const redisUrl = resolveRedisUrlFromEnv(env)
  const raw = env.CACHE_DRIVER?.trim().toLowerCase()

  if (raw === undefined || raw === '') {
    if (redisUrl) return { driver: 'redis', redisUrl }
    return { driver: 'memory' }
  }

  if (raw !== 'memory' && raw !== 'redis') {
    throw new Error(`CACHE_DRIVER must be "memory" or "redis" (got ${raw})`)
  }

  if (raw === 'redis') {
    if (!redisUrl) {
      throw new Error(
        'CACHE_DRIVER=redis requires REDIS_URL or REDIS_HOST (optional REDIS_PORT / REDIS_PASSWORD / REDIS_DB). Unset CACHE_DRIVER or set CACHE_DRIVER=memory for the in-process fallback.'
      )
    }
    return { driver: 'redis', redisUrl }
  }

  return { driver: 'memory', redisUrl: redisUrl || undefined }
}

/**
 * Load hosting config from process.env. Throws on missing required secrets.
 */
export function loadHostingConfig(cwd = process.cwd()): HostingConfig {
  const driver = (process.env.DATABASE_DRIVER ?? 'postgres').toLowerCase() as DatabaseDriver
  if (driver !== 'sqlite' && driver !== 'postgres') {
    throw new Error(`DATABASE_DRIVER must be "sqlite" or "postgres" (got ${driver})`)
  }

  const mediaDriver = (process.env.MEDIA_DRIVER ?? 'filesystem').toLowerCase() as MediaDriver
  if (mediaDriver !== 'filesystem' && mediaDriver !== 's3') {
    throw new Error(`MEDIA_DRIVER must be "filesystem" or "s3" (got ${mediaDriver})`)
  }

  const { driver: cacheDriver, redisUrl } = resolveCacheDriverFromEnv()

  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (driver === 'postgres' && !databaseUrl) {
    throw new Error('DATABASE_URL is required when DATABASE_DRIVER=postgres')
  }

  const apiRoot = cwd.endsWith('/apps/api') || cwd.endsWith('\\apps\\api') ? cwd : `${cwd}/apps/api`
  const repoRoot = apiRoot.replace(/[/\\]apps[/\\]api$/, '')

  const passthroughKeys = [
    'CORS_ALLOWED_ORIGINS',
    'ADMIN_CORS_ALLOWED_ORIGINS',
    'PUBLIC_CORS_ALLOWED_ORIGINS',
    'PREVIEW_SECRET',
    'ASSET_SIGNING_SECRET',
    'MEDIA_PUBLIC_BASE_URL',
    'CDN_BASE_URL',
    'CDN_PUBLIC_BASE_URL',
    'WEBHOOK_ALLOWED_HOSTS',
    'AUDIT_RETENTION_DAYS',
    'QWEN_API_KEY',
    'GEMINI_API_KEY',
    'AI_GATEWAY_URL',
    'EDGE_PLUGINS_JSON',
    'JWT_ISSUER',
    'JWT_AUDIENCE',
    'JWT_REQUIRED_FOR_ADMIN',
    'ENTRA_CLIENT_ID',
    'ENTRA_CLIENT_SECRET',
    'ENTRA_TENANT_ID',
    'ENTRA_REDIRECT_URI',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    // Forwarded for hosts that layer SSO packaging; core auth uses ENTRA_* only.
    'SSO_MODE',
    'SSO_LOCAL_AUTH_LOCKOUT',
    'SSO_BREAK_GLASS_LOCAL',
    'SSO_ROLE_MAP',
    'SSO_DEFAULT_TENANT_SLUG',
    'HSTS_MAX_AGE_SECONDS',
  ] as const

  const passthrough: Record<string, string> = {}
  for (const key of passthroughKeys) {
    const value = process.env[key]
    if (value !== undefined && value !== '') passthrough[key] = value
  }

  const port = Number(process.env.PORT ?? '8787')
  const hostname = process.env.HOST ?? '0.0.0.0'
  const baseUrl = (process.env.BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, '')

  return {
    runtime: 'node',
    port: Number.isFinite(port) ? port : 8787,
    hostname,
    baseUrl,
    database: {
      driver,
      sqlitePath: process.env.SQLITE_PATH ?? `${apiRoot}/.data/edgecms.sqlite`,
      databaseUrl,
      migrationsDir:
        process.env.MIGRATIONS_DIR ??
        (driver === 'postgres'
          ? `${apiRoot}/drizzle/postgres`
          : `${apiRoot}/drizzle/migrations`),
    },
    cache: {
      driver: cacheDriver,
      redisUrl,
    },
    media: {
      driver: mediaDriver,
      dataDir: process.env.MEDIA_DATA_DIR ?? `${apiRoot}/.data/media`,
      endpoint: process.env.S3_ENDPOINT ?? process.env.OSS_ENDPOINT,
      region: process.env.S3_REGION ?? process.env.OSS_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? process.env.OSS_BUCKET ?? 'edgecms-media',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? process.env.OSS_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? process.env.OSS_SECRET_ACCESS_KEY,
      forcePathStyle: envFlag('S3_FORCE_PATH_STYLE', true),
      // CDN first (Strapi / R2 custom-domain style), then legacy MEDIA_PUBLIC_BASE_URL.
      publicBaseUrl:
        process.env.CDN_BASE_URL?.trim() ||
        process.env.CDN_PUBLIC_BASE_URL?.trim() ||
        process.env.MEDIA_PUBLIC_BASE_URL?.trim() ||
        undefined,
      cdnBaseUrl:
        process.env.CDN_BASE_URL?.trim() ||
        process.env.CDN_PUBLIC_BASE_URL?.trim() ||
        undefined,
    },
    adminDistDir: process.env.ADMIN_DIST_DIR ?? `${repoRoot}/apps/admin/dist`,
    secrets: {
      betterAuthSecret: requireSecret('BETTER_AUTH_SECRET'),
      jwtHs256Secret: process.env.JWT_HS256_SECRET?.trim() || undefined,
    },
    featureFlags: {
      enablePromoteCacheWarming: envFlag('ENABLE_PROMOTE_CACHE_WARMING', false),
      enablePublicCacheWarming: envFlag('ENABLE_PUBLIC_CACHE_WARMING', false),
      enableReleaseSemantic: envFlag('ENABLE_RELEASE_SEMANTIC', false),
      signupPolicy: process.env.SIGNUP_POLICY ?? 'disabled',
      superAdminEmails: process.env.SUPER_ADMIN_EMAILS ?? '',
      superAdminRequireMfa: envFlag('SUPER_ADMIN_REQUIRE_MFA', true),
    },
    passthrough,
  }
}
