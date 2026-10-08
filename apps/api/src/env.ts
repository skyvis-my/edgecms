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
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  QWEN_API_KEY?: string
  GEMINI_API_KEY?: string
  AI_GATEWAY_URL?: string
  AI_GATEWAY_ROUTE_ID?: string
  AI_GATEWAY_GUARDRAILS_PROFILE_ID?: string
  ENABLE_AI_IMPORT_REVIEW?: string
  EDGE_PLUGINS_JSON?: string
  EDGE_PLUGIN_HOOK_TIMEOUT_MS?: string
  CF_API_TOKEN?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  EDGECMS_API_KEY?: string
  MCP_API_KEY?: string
  SUPER_ADMIN_EMAILS?: string
  SUPER_ADMIN_DEV_MODE?: string
  WEBHOOK_ALLOWED_HOSTS?: string
  CORS_ALLOWED_ORIGINS?: string
  ADMIN_CORS_ALLOWED_ORIGINS?: string
  PUBLIC_CORS_ALLOWED_ORIGINS?: string
  BASE_URL?: string
  HSTS_MAX_AGE_SECONDS?: string
  HSTS_INCLUDE_SUBDOMAINS?: string
  HSTS_PRELOAD?: string
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
  GOOGLE_CLIENT_ID: 'string',
  GOOGLE_CLIENT_SECRET: 'string',
  QWEN_API_KEY: 'string',
  GEMINI_API_KEY: 'string',
  AI_GATEWAY_URL: 'string',
  AI_GATEWAY_ROUTE_ID: 'string',
  AI_GATEWAY_GUARDRAILS_PROFILE_ID: 'string',
  ENABLE_AI_IMPORT_REVIEW: 'string',
  EDGE_PLUGINS_JSON: 'string',
  EDGE_PLUGIN_HOOK_TIMEOUT_MS: 'string',
  WEBHOOK_ALLOWED_HOSTS: 'string',
  SUPER_ADMIN_EMAILS: 'string',
  SUPER_ADMIN_DEV_MODE: 'string',
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
