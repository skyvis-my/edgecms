import { resolveApiBasePath } from './api-base-path'

/**
 * Short-lived RBAC access-token manager for the admin SPA.
 *
 * The API mints stateless tokens (`GET /api/auth/access-token`) that let the
 * security guard skip session + membership D1 reads. This module:
 * - caches one token per tenant (plus a global token) with proactive refresh,
 * - deduplicates in-flight mints,
 * - never throws: token failures fall back to cookie-session requests.
 */

const REFRESH_MARGIN_MS = 60_000
const FALLBACK_TTL_MS = 9 * 60_000

type CachedToken = { token: string; expiresAtMs: number }

const tokenCache = new Map<string, CachedToken>()
const inflight = new Map<string, Promise<string | null>>()

function keyFor(tenantSlug: string | null): string {
  return tenantSlug ?? ''
}

/** Test-only reset for the module-level cache. */
export function __resetAccessTokenCacheForTests(): void {
  tokenCache.clear()
  inflight.clear()
}

function parseExpiresAtMs(payload: unknown): number | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const data = (payload as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return undefined
  const expiresAt = (data as { expiresAt?: unknown }).expiresAt
  if (typeof expiresAt !== 'string') return undefined
  const parsed = Date.parse(expiresAt)
  return Number.isNaN(parsed) ? undefined : parsed
}

function parseToken(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const data = (payload as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return undefined
  const token = (data as { token?: unknown }).token
  return typeof token === 'string' && token ? token : undefined
}

async function mintAccessToken(tenantSlug: string | null): Promise<CachedToken | null> {
  if (typeof fetch === 'undefined') return null
  try {
    const query = tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : ''
    const response = await fetch(`${resolveApiBasePath()}/auth/access-token${query}`, {
      credentials: 'include',
    })
    if (!response.ok) return null
    const payload: unknown = await response.json()
    const token = parseToken(payload)
    if (!token) return null
    return { token, expiresAtMs: parseExpiresAtMs(payload) ?? Date.now() + FALLBACK_TTL_MS }
  } catch {
    return null
  }
}

function isFresh(entry: CachedToken, now: number = Date.now()): boolean {
  return entry.expiresAtMs - REFRESH_MARGIN_MS > now
}

/**
 * Sync read for the request hot path. Returns the token only when it is
 * fresh enough to use; otherwise null (no fetch here, by design).
 */
export function getCachedAccessToken(tenantSlug: string | null): string | null {
  const entry = tokenCache.get(keyFor(tenantSlug))
  if (!entry || !isFresh(entry)) return null
  return entry.token
}

/**
 * Ensure a fresh token, deduplicating concurrent mints.
 * Resolves null when minting fails — callers fall back to cookies.
 */
export function ensureAccessToken(
  tenantSlug: string | null,
  options?: { force?: boolean }
): Promise<string | null> {
  const key = keyFor(tenantSlug)
  if (!options?.force) {
    const cached = tokenCache.get(key)
    if (cached && isFresh(cached)) return Promise.resolve(cached.token)
  }
  const pending = inflight.get(key)
  if (pending) return pending
  const run = mintAccessToken(tenantSlug).then((entry) => {
    inflight.delete(key)
    if (!entry) {
      if (options?.force) tokenCache.delete(key)
      return null
    }
    tokenCache.set(key, entry)
    return entry.token
  })
  inflight.set(key, run)
  return run
}

/**
 * Fire-and-forget refresh when a cached token exists but is near expiry.
 * No-op when nothing is cached, so idle pages and tests stay quiet.
 */
export function refreshAccessTokenIfExpiring(tenantSlug: string | null): void {
  const key = keyFor(tenantSlug)
  const entry = tokenCache.get(key)
  if (!entry || isFresh(entry) || inflight.has(key)) return
  if (typeof fetch === 'undefined') return
  void ensureAccessToken(tenantSlug, { force: true }).catch(() => {})
}

/** Drop cached tokens: all on sign-out, or one scope on tenant switch. */
export function clearAccessTokens(tenantSlug?: string | null): void {
  if (tenantSlug === undefined) {
    tokenCache.clear()
    return
  }
  tokenCache.delete(keyFor(tenantSlug))
}
