import {
  DEFAULT_RATE_LIMIT_POLICIES,
  type RateLimitCategory,
} from '@/auth/rate-limit.middleware'
import { logger } from '@/observability/logger'
import type { HostPolicies, TenantRateLimitPolicy } from './host-policies'
import { sanitizeUpgradeUrl } from './limits'

/** Resolves the rate-limit policy for one tenant route (HS-07). */
export type TenantRateLimitResolver = (
  tenantSlug: string,
  category: RateLimitCategory
) => Promise<TenantRateLimitPolicy>

const CACHE_TTL_MS = 30_000
const MAX_CACHE_ENTRIES = 1_000

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** Accept a host policy only when its numbers are usable; otherwise keep the default. */
function normalizePolicy(
  policy: TenantRateLimitPolicy | undefined,
  fallback: TenantRateLimitPolicy
): TenantRateLimitPolicy {
  if (!policy || typeof policy !== 'object') return fallback
  if (!isPositiveInteger(policy.windowMs) || !isPositiveInteger(policy.limit)) return fallback
  const upgradeUrl = sanitizeUpgradeUrl(policy.upgradeUrl)
  return {
    windowMs: policy.windowMs,
    limit: policy.limit,
    ...(isPositiveInteger(policy.tenantLimit) && { tenantLimit: policy.tenantLimit }),
    ...(upgradeUrl && { upgradeUrl }),
  }
}

/**
 * Per-instance resolver for `host.rateLimits`. Without a host hook it is
 * `undefined` and the security guard keeps the framework policies. Results
 * are cached for 30 s per tenant and category so the hot path rarely calls
 * the host; a throwing hook keeps the framework policy.
 */
export function createTenantRateLimitResolver(
  rateLimits: HostPolicies['rateLimits'],
  now: () => number = Date.now
): TenantRateLimitResolver | undefined {
  if (!rateLimits) return undefined
  const cache = new Map<string, { policy: TenantRateLimitPolicy; expiresAt: number }>()

  return async (tenantSlug, category) => {
    const key = `${tenantSlug}\u0000${category}`
    const cached = cache.get(key)
    const at = now()
    if (cached && cached.expiresAt > at) return cached.policy

    const defaultPolicy = DEFAULT_RATE_LIMIT_POLICIES[category]
    let policy: TenantRateLimitPolicy
    try {
      policy = normalizePolicy(
        await rateLimits({ tenantSlug, category, defaultPolicy }),
        defaultPolicy
      )
    } catch (err) {
      logger.warn('host_rate_limit_policy_failed', {
        tenantSlug,
        category,
        error: err instanceof Error ? err.message : String(err),
      })
      policy = defaultPolicy
    }
    // Evict the oldest entry only, so unknown slugs cannot flush every tenant's policy.
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.delete(key)
    cache.set(key, { policy, expiresAt: at + CACHE_TTL_MS })
    return policy
  }
}
