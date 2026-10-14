import type { TenantRow } from './tenants.repository'
import type { FastPathActor } from '@/auth/access-token-guard'

const requestTenantCache = new WeakMap<Request, Map<string, Promise<TenantRow | undefined>>>()
const requestMembershipCache = new WeakMap<Request, Map<string, Promise<string | null>>>()
export type CachedFastPath = { actor: FastPathActor; tenantSlug: string | undefined }
const requestFastPathCache = new WeakMap<Request, CachedFastPath>()

/**
 * Retrieves a cached tenant resolution promise for this Request lifecycle.
 */
export function getCachedTenant(
  request: Request,
  slug: string
): Promise<TenantRow | undefined> | undefined {
  return requestTenantCache.get(request)?.get(slug)
}

/**
 * Stores a tenant resolution promise for this Request lifecycle.
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
