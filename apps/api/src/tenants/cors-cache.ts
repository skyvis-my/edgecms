import { CACHE_NAMESPACE, getMemoryTTL } from '@/cache/cache-config'

const MAX_CORS_CACHE_ENTRIES = 500
type CorsEntry = { value: string | null; expiresAtMs: number }
const corsCache = new Map<string, CorsEntry>()
const inFlightResolvers = new Map<string, Promise<string | null>>()

function getCorsCacheTTLMs(): number {
  return getMemoryTTL(CACHE_NAMESPACE.CORS) * 1000
}

export async function getCachedCorsOrigin(
  tenantSlug: string,
  resolver: (slug: string) => Promise<string | null>
): Promise<string | null> {
  const cached = corsCache.get(tenantSlug)
  if (cached && cached.expiresAtMs > Date.now()) {
    // Re-insert to promote to MRU
    corsCache.delete(tenantSlug)
    corsCache.set(tenantSlug, cached)
    return cached.value
  }

  const existingInFlight = inFlightResolvers.get(tenantSlug)
  if (existingInFlight) {
    return existingInFlight
  }

  const fetchPromise = (async () => {
    try {
      const value = await resolver(tenantSlug)
      if (corsCache.size >= MAX_CORS_CACHE_ENTRIES) {
        const oldestKey = corsCache.keys().next().value
        if (oldestKey) corsCache.delete(oldestKey)
      }
      corsCache.set(tenantSlug, {
        value,
        expiresAtMs: Date.now() + getCorsCacheTTLMs(),
      })
      return value
    } finally {
      inFlightResolvers.delete(tenantSlug)
    }
  })()

  inFlightResolvers.set(tenantSlug, fetchPromise)
  return fetchPromise
}

export function invalidateCorsCache(tenantSlug?: string): void {
  if (tenantSlug) {
    corsCache.delete(tenantSlug)
    inFlightResolvers.delete(tenantSlug)
  } else {
    corsCache.clear()
    inFlightResolvers.clear()
  }
}

export function __resetCorsCacheForTests(): void {
  invalidateCorsCache()
}
