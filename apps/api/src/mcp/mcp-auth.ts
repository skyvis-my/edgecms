import type { Env } from '@/env'

/** Tenant-scoped MCP endpoint that external MCP clients call (not the admin alias). */
export const TENANT_MCP_PATH = /^\/api\/tenants\/[^/]+\/api\/mcp\/?$/

const encoder = new TextEncoder()

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.byteLength !== bBytes.byteLength) return false
  let mismatch = 0
  for (let i = 0; i < aBytes.byteLength; i++) {
    mismatch |= aBytes[i]! ^ bBytes[i]!
  }
  return mismatch === 0
}

/** The `X-EdgeCMS-API-Key` header value, trimmed, if present. */
export function readApiKeyHeader(request: Request): string | undefined {
  const value = request.headers.get('x-edgecms-api-key')?.trim()
  return value ? value : undefined
}

/** The `Authorization: Bearer <token>` value, if present. */
export function readBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization')?.trim()
  if (!authorization) return undefined
  const match = /^Bearer\s+(\S+)$/i.exec(authorization)
  return match?.[1]
}

/** True when `candidate` equals the deployment's `EDGECMS_API_KEY` or `MCP_API_KEY`. */
export function matchesMcpApiKey(candidate: string | undefined, workerEnv: Partial<Env>): boolean {
  if (!candidate) return false
  const keys = [workerEnv.EDGECMS_API_KEY, workerEnv.MCP_API_KEY].filter(
    (key): key is string => typeof key === 'string' && key.length > 0
  )
  let matched = false
  for (const key of keys) {
    if (timingSafeEqual(candidate, key)) matched = true
  }
  return matched
}

/** True when the request carries a valid deployment MCP API key (header or bearer). */
export function hasValidMcpApiKey(request: Request, workerEnv: Partial<Env>): boolean {
  return (
    matchesMcpApiKey(readApiKeyHeader(request), workerEnv) ||
    matchesMcpApiKey(readBearerToken(request), workerEnv)
  )
}

/** A compact JWS (three base64url segments), as issued by `/api/auth/access-token`. */
export function looksLikeJwt(token: string | undefined): boolean {
  return !!token && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
}
