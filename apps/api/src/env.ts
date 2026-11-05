/**
 * Cloudflare Worker environment bindings.
 * These correspond to wrangler bindings used by the API worker.
 */
export interface Env {
  DB: D1Database
  CACHE: KVNamespace
  MEDIA: R2Bucket
  ASSET_VECTORS?: VectorizeIndex
  ASSETS: Fetcher
  PUBLISH_SCHEDULER: DurableObjectNamespace
  WEBHOOK_QUEUE: Queue
  BETTER_AUTH_SECRET?: string
  JWT_HS256_SECRET?: string
  JWT_ISSUER?: string
  JWT_AUDIENCE?: string
  JWT_REQUIRED_FOR_ADMIN?: string
  ENTRA_CLIENT_ID?: string
  ENTRA_CLIENT_SECRET?: string
  ENTRA_TENANT_ID?: string
  /**
   * Optional ops echo of the Entra reply URL. Must equal
   * `${BASE_URL}/api/auth/callback/microsoft` when set (fails closed otherwise).
   */
  ENTRA_REDIRECT_URI?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** Public media / CDN origin for OSS self-host and Workers custom domains. */
  MEDIA_PUBLIC_BASE_URL?: string
  CDN_BASE_URL?: string
  CDN_PUBLIC_BASE_URL?: string
  /** Opt-in cache warming flags (Workers and OSS hosting). */
  ENABLE_PROMOTE_CACHE_WARMING?: string
  ENABLE_PUBLIC_CACHE_WARMING?: string
  /** Optional deploy id label for OSS hosting / co-version evidence. */
  EDGECMS_DEPLOY_ID?: string
  QWEN_API_KEY?: string
  GEMINI_API_KEY?: string
  AI_GATEWAY_URL?: string
  AI_GATEWAY_ROUTE_ID?: string
  AI_GATEWAY_GUARDRAILS_PROFILE_ID?: string
  ENABLE_AI_IMPORT_REVIEW?: string
  /** HS-12: audit event retention in days (minimum and default 365). */
  AUDIT_RETENTION_DAYS?: string
  EDGE_PLUGINS_JSON?: string
  EDGE_PLUGIN_HOOK_TIMEOUT_MS?: string
  /** Opt-in: mirror metric counters to KV (one write per increment). */
  EDGE_METRICS_KV_SINK?: string
  CF_API_TOKEN?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_ZONE_ID?: string
  FRONTEND_REVALIDATE_URL?: string
  FRONTEND_REVALIDATE_SECRET?: string
  EDGECMS_API_KEY?: string
  MCP_API_KEY?: string
  SUPER_ADMIN_EMAILS?: string
  SUPER_ADMIN_DEV_MODE?: string
  SUPER_ADMIN_REQUIRE_MFA?: string
  SIGNUP_POLICY?: string
  AUTH_EMAIL_SENDER?: string
  PREVIEW_SECRET?: string
  /** DL-07: signs x402/L402 paid-read challenges and settlement tokens; no fallback. */
  X402_SECRET?: string
  WEBHOOK_ALLOWED_HOSTS?: string
  CORS_ALLOWED_ORIGINS?: string
  ADMIN_CORS_ALLOWED_ORIGINS?: string
  PUBLIC_CORS_ALLOWED_ORIGINS?: string
  BASE_URL?: string
  HSTS_MAX_AGE_SECONDS?: string
  HSTS_INCLUDE_SUBDOMAINS?: string
  HSTS_PRELOAD?: string
  /** DL-10: optional Cloudflare rate-limiting binding for public reads. */
  PUBLIC_READ_RATE_LIMITER?: import('./auth/public-read-rate-limit').RateLimitBinding
  /** DL-10: `kv` keeps the KV-backed public-read counter (default: in-isolate). */
  PUBLIC_READ_RATE_LIMIT_STORE?: string
}

export const envSchema = {
  BETTER_AUTH_SECRET: 'string',
  JWT_HS256_SECRET: 'string',
  JWT_ISSUER: 'string',
  JWT_AUDIENCE: 'string',
  JWT_REQUIRED_FOR_ADMIN: 'string',
  ENTRA_CLIENT_ID: 'string',
  ENTRA_CLIENT_SECRET: 'string',
  ENTRA_TENANT_ID: 'string',
  ENTRA_REDIRECT_URI: 'string',
  GOOGLE_CLIENT_ID: 'string',
  GOOGLE_CLIENT_SECRET: 'string',
  MEDIA_PUBLIC_BASE_URL: 'string',
  CDN_BASE_URL: 'string',
  CDN_PUBLIC_BASE_URL: 'string',
  ENABLE_PROMOTE_CACHE_WARMING: 'string',
  ENABLE_PUBLIC_CACHE_WARMING: 'string',
  EDGECMS_DEPLOY_ID: 'string',
  QWEN_API_KEY: 'string',
  GEMINI_API_KEY: 'string',
  AI_GATEWAY_URL: 'string',
  AI_GATEWAY_ROUTE_ID: 'string',
  AI_GATEWAY_GUARDRAILS_PROFILE_ID: 'string',
  ENABLE_AI_IMPORT_REVIEW: 'string',
  AUDIT_RETENTION_DAYS: 'string',
  EDGE_PLUGINS_JSON: 'string',
  EDGE_PLUGIN_HOOK_TIMEOUT_MS: 'string',
  EDGE_METRICS_KV_SINK: 'string',
  WEBHOOK_ALLOWED_HOSTS: 'string',
  SUPER_ADMIN_EMAILS: 'string',
  SUPER_ADMIN_DEV_MODE: 'string',
  SUPER_ADMIN_REQUIRE_MFA: 'string',
  SIGNUP_POLICY: 'string',
  AUTH_EMAIL_SENDER: 'string',
  CORS_ALLOWED_ORIGINS: 'string',
  ADMIN_CORS_ALLOWED_ORIGINS: 'string',
  PUBLIC_CORS_ALLOWED_ORIGINS: 'string',
  BASE_URL: 'string',
  HSTS_MAX_AGE_SECONDS: 'string',
  HSTS_INCLUDE_SUBDOMAINS: 'string',
  HSTS_PRELOAD: 'string',
  CF_API_TOKEN: 'string',
  CLOUDFLARE_ACCOUNT_ID: 'string',
  EDGECMS_API_KEY: 'string',
  MCP_API_KEY: 'string',
} as const
