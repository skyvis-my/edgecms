import type { TenantRow } from './tenants.repository'
import type { FastPathActor } from '@/auth/access-token-guard'

const requestTenantCache = new WeakMap<Request, Map<string, Promise<TenantRow | undefined>>>()
const requestMembershipCache = new WeakMap<Request, Map<string, Promise<string | null>>>()
export type CachedFastPath = { actor: FastPathActor; tenantSlug: string | undefined }
const requestFastPathCache = new WeakMap<Request, CachedFastPath>()

type IsolateTenantCacheEntry = {
  tenant?: TenantRow
  expiresAt: number
}

const ISOLATE_TENANT_CACHE_MAX = 200
const ISOLATE_TENANT_TTL_MS = 20_000 // 20s for active tenant rows
const ISOLATE_NEGATIVE_TTL_MS = 5_000 // 5s for not found slugs to prevent D1 stampedes on bogus slugs

const isolateTenantCache = new Map<string, IsolateTenantCacheEntry>()

let isolateTenantCacheEnabled =
  typeof process === 'undefined' || process.env.NODE_ENV !== 'test'

export function setTenantIsolateCacheEnabled(enabled: boolean): void {
  isolateTenantCacheEnabled = enabled
}

export function isTenantIsolateCacheEnabled(): boolean {
  return isolateTenantCacheEnabled
}

export function getIsolateCachedTenant(slug: string): TenantRow | null | undefined {
  if (!isolateTenantCacheEnabled) return undefined
  const entry = isolateTenantCache.get(slug)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    isolateTenantCache.delete(slug)
    return undefined
  }
  // LRU promotion
  isolateTenantCache.delete(slug)
  isolateTenantCache.set(slug, entry)
  return entry.tenant ?? null
}

export function setIsolateCachedTenant(slug: string, tenant: TenantRow | undefined): void {
  if (!isolateTenantCacheEnabled) return
  if (isolateTenantCache.size >= ISOLATE_TENANT_CACHE_MAX) {
    const oldestKey = isolateTenantCache.keys().next().value
    if (oldestKey !== undefined) isolateTenantCache.delete(oldestKey)
  }
  const ttl = tenant ? ISOLATE_TENANT_TTL_MS : ISOLATE_NEGATIVE_TTL_MS
  isolateTenantCache.set(slug, {
    tenant,
    expiresAt: Date.now() + ttl,
  })
}

export function clearTenantIsolateCache(slug?: string): void {
  if (slug) {
    isolateTenantCache.delete(slug)
  } else {
    isolateTenantCache.clear()
  }
}

/**
 * Retrieves a cached tenant resolution promise for this Request lifecycle,
 * checking the in-isolate bounded memory cache first to eliminate D1 lookups.
 */
export function getCachedTenant(
  request: Request,
  slug: string
): Promise<TenantRow | undefined> | undefined {
  const reqCached = requestTenantCache.get(request)?.get(slug)
  if (reqCached) return reqCached

  const isolateCached = getIsolateCachedTenant(slug)
  if (isolateCached !== undefined) {
    const promise = Promise.resolve(isolateCached === null ? undefined : isolateCached)
    let map = requestTenantCache.get(request)
    if (!map) {
      map = new Map()
      requestTenantCache.set(request, map)
    }
    map.set(slug, promise)
    return promise
  }
  return undefined
}

/**
 * Stores a tenant resolution promise for this Request lifecycle, and populates
 * the in-isolate bounded LRU cache upon successful resolution.
 */
export function setCachedTenant(
  request: Request,
  slug: string,
  promise: Promise<TenantRow | undefined>
): void {
  let map = requestTenantCache.get(request)
  if (!map) {
    map = new Map()
    requestTenantCache.set(request, map)
  }
  map.set(slug, promise)
  promise.then(
    (tenant) => {
      setIsolateCachedTenant(slug, tenant)
    },
    () => {
      // Don't cache rejected queries in isolate
    }
  )
}

/**
 * Retrieves a cached tenant membership role for this Request lifecycle.
 */
export function getCachedMembership(
  request: Request,
  userId: string,
  tenantIdOrSlug: string
): Promise<string | null> | undefined {
  const key = `${userId}:${tenantIdOrSlug}`
  return requestMembershipCache.get(request)?.get(key)
}

/**
 * Stores a tenant membership role resolution promise for this Request lifecycle.
 */
export function setCachedMembership(
  request: Request,
  userId: string,
  tenantIdOrSlug: string,
  promise: Promise<string | null>
): void {
  let map = requestMembershipCache.get(request)
  if (!map) {
    map = new Map()
    requestMembershipCache.set(request, map)
  }
  map.set(`${userId}:${tenantIdOrSlug}`, promise)
}

/**
 * Stateless RBAC fast-path actor verified earlier in the request lifecycle
 * (api-security guard). Stored per-Request so tenant middleware and the
 * `{ auth: true }` macro reuse verified claims with zero D1 reads.
 */
export function getCachedFastActor(request: Request): CachedFastPath | undefined {
  return requestFastPathCache.get(request)
}

export function setCachedFastActor(
  request: Request,
  actor: FastPathActor,
  tenantSlug: string | undefined
): void {
  requestFastPathCache.set(request, { actor, tenantSlug })
}
