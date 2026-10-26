import type { CacheMetadataTracker } from '@/cache/cache-metadata'
import { CACHE_NAMESPACE, getMemoryTTL, type CacheNamespace } from '@/cache/cache-config'
import { LRUMemoryCache } from '@/cache/memory-cache'
import { logger } from '@/observability/logger'
import { incrementMetric } from '@/observability/metrics'

const MEMORY_CACHE_MAX_BYTES = 8 * 1024 * 1024 // 8 MB: well clear of the 128 MB isolate limit

const memorySnapshotCache = new LRUMemoryCache({ maxSizeBytes: MEMORY_CACHE_MAX_BYTES })

// Singleflight promise deduplication to guard against cache stampedes and redundant KV reads
const inFlightKVReads = new Map<string, Promise<unknown | null>>()
const inFlightVersionReads = new Map<string, Promise<number>>()
const inFlightGetOrSet = new Map<string, Promise<unknown | null>>()

/** Short-TTL L1 for collection/locale version counters (avoids a KV read per request). */
const VERSION_CACHE_TTL_SECONDS = 10

function versionCacheKey(collectionSlug: string, locale: string, tenantScope?: string): string {
  return tenantScope
    ? `__ver:${tenantScope}:${collectionSlug}:${locale}`
    : `__ver:global:${collectionSlug}:${locale}`
}

function writeFrozenMemorySnapshot(
  key: string,
  value: unknown,
  ttlSeconds: number,
  sizeBytes: number
): void {
  memorySnapshotCache.setFrozen(key, value, ttlSeconds, sizeBytes)
}

function readMemorySnapshot(key: string): unknown | null {
  return memorySnapshotCache.getFrozen(key)
}

/**
 * KV Service — Handles versioned snapshot storage in Cloudflare KV.
 *
 * This service provides an abstraction layer over KV for storing and invalidating
 * content snapshots. It uses a versioned key scheme to enable cache invalidation
 * without physically deleting keys — incrementing the version makes old keys stale.
 *
 * Key scheme:
 * - Base keys: `snapshot:{collectionSlug}:{locale}:list` and `snapshot:{collectionSlug}:{locale}:entry:{entrySlug}`
 * - Versioned keys: `v{version}:{baseKey}` — version increments on invalidation
 * - Version metadata: `version:{collectionSlug}:{locale}` stores current version counter
 *
 * Example flow:
 * 1. Store snapshot with key `v1:snapshot:articles:en:list`
 * 2. On invalidation, increment version for `articles:en` to 2
 * 3. Next read requests `v2:snapshot:articles:en:list` (old v1 key is now stale)
 * 4. KV eventually expires stale keys based on TTL
 */

/**
 * KV service interface for snapshot storage operations.
 */
export const kvService = {
  __resetInMemorySnapshotCacheForTests() {
    memorySnapshotCache.clear()
    inFlightKVReads.clear()
    inFlightVersionReads.clear()
    inFlightGetOrSet.clear()
  },

  getMemoryCacheStats() {
    return memorySnapshotCache.stats()
  },

  /**
   * Get the current version number for a collection + locale combination.
   *
   * If no version exists yet, returns 1 (the initial version).
   *
   * @param kv - KV namespace binding
   * @param collectionSlug - Collection slug
   * @param locale - Locale code
   * @param tenantScope - Optional tenant scope key (tenantId) for key prefixing
   * @returns Current version number (defaults to 1)
   */
  async getCurrentVersion(
    kv: KVNamespace,
    collectionSlug: string,
    locale: string,
    tenantScope?: string
  ): Promise<number> {
    const cacheKey = versionCacheKey(collectionSlug, locale, tenantScope)
    const cached = memorySnapshotCache.getFrozen(cacheKey)
    if (typeof cached === 'number' && Number.isInteger(cached) && cached >= 1) {
      return cached
    }
    const versionKey = tenantScope
      ? `${tenantScope}:version:${collectionSlug}:${locale}`
      : `version:${collectionSlug}:${locale}`

    const inFlight = inFlightVersionReads.get(versionKey)
    if (inFlight) return inFlight

    const readPromise = (async () => {
      try {
        const versionStr = await kv.get(versionKey)
        const version = versionStr ? Number.parseInt(versionStr, 10) : 1
        const normalized = Number.isInteger(version) && version >= 1 ? version : 1
        memorySnapshotCache.setFrozen(cacheKey, normalized, VERSION_CACHE_TTL_SECONDS, 16)
        return normalized
      } finally {
        inFlightVersionReads.delete(versionKey)
      }
    })()

    inFlightVersionReads.set(versionKey, readPromise)
    return readPromise
  },

  /**
   * Increment the version counter for a collection + locale combination.
   *
   * This invalidates all snapshots associated with this collection/locale by
   * making their versioned keys stale. The next read will request a higher version.
   *
   * @param kv - KV namespace binding
   * @param collectionSlug - Collection slug
   * @param locale - Locale code
   * @param tenantScope - Optional tenant scope key (tenantId) for key prefixing
   * @returns The new version number after increment
   */
  async incrementVersion(
    kv: KVNamespace,
    collectionSlug: string,
    locale: string,
    tenantScope?: string
  ): Promise<number> {
    const currentVersion = await this.getCurrentVersion(kv, collectionSlug, locale, tenantScope)
    const newVersion = currentVersion + 1
    const versionKey = tenantScope
      ? `${tenantScope}:version:${collectionSlug}:${locale}`
      : `version:${collectionSlug}:${locale}`

    // Store the new version number (no TTL — version counters persist indefinitely).
    // This is intentional: versioning IS the invalidation mechanism (readers
    // always request the current version, so stale versioned snapshot keys age
    // out via their own TTLs). Expiring a version key would reset it to 1 and
    // resurrect stale snapshots — worse than the few bytes of counter storage.
    await kv.put(versionKey, newVersion.toString())
    inFlightVersionReads.delete(versionKey)
    memorySnapshotCache.setFrozen(
      versionCacheKey(collectionSlug, locale, tenantScope),
      newVersion,
      VERSION_CACHE_TTL_SECONDS,
      16
    )
    return newVersion
  },

  /**
   * Generate a versioned key for a snapshot.
   *
   * Versioned keys follow the pattern: `v{version}:{baseKey}` (single-tenant)
   * or `{tenantScope}:v{version}:{baseKey}` (multi-tenant)
   *
   * @param baseKey - Base snapshot key (e.g., 'snapshot:articles:en:list')
   * @param version - Version number
   * @param tenantScope - Optional tenant scope key (tenantId) for key prefixing
   * @returns Versioned key (e.g., 'v1:snapshot:articles:en:list' or 'acme:v1:snapshot:articles:en:list')
   */
  getVersionedKey(baseKey: string, version: number, tenantScope?: string): string {
    return tenantScope ? `${tenantScope}:v${version}:${baseKey}` : `v${version}:${baseKey}`
  },

  /**
   * Retrieve a snapshot from KV and parse it as JSON.
   *
   * @param kv - KV namespace binding
   * @param key - Versioned or unversioned key
   * @returns Parsed JSON data, or null if not found
   */
  async getSnapshot(
    kv: KVNamespace,
    key: string,
    tracker?: CacheMetadataTracker,
    namespace: CacheNamespace = CACHE_NAMESPACE.CONTENT
  ): Promise<unknown | null> {
    const inMemoryValue = readMemorySnapshot(key)
    if (inMemoryValue !== null) {
      incrementMetric('cache_hits_total', { layer: 'memory' })
      tracker?.recordHit('memory')
      return inMemoryValue
    }
    const inFlight = inFlightKVReads.get(key)
    if (inFlight) {
      const result = await inFlight
      if (result !== null) {
        incrementMetric('cache_hits_total', { layer: 'kv' })
        tracker?.recordHit('kv')
        return result
      }
      return null
    }

    const readPromise = (async () => {
      try {
        incrementMetric('cache_misses_total', { layer: 'memory' })
        const value = await kv.get(key)
        if (!value) {
          incrementMetric('cache_misses_total', { layer: 'kv' })
          return null
        }
        try {
          const parsed = JSON.parse(value)
          // Single stringify for size accounting: reuse the KV payload length
          // instead of re-serializing inside the LRU cache.
          writeFrozenMemorySnapshot(key, parsed, getMemoryTTL(namespace), value.length * 2)
          return parsed
        } catch {
          logger.error('snapshot_json_parse_failed', { key })
          return null
        }
      } finally {
        inFlightKVReads.delete(key)
      }
    })()

    inFlightKVReads.set(key, readPromise)
    const result = await readPromise
    if (result !== null) {
      incrementMetric('cache_hits_total', { layer: 'kv' })
      tracker?.recordHit('kv')
    }
    return result
  },

  /**
   * Store a snapshot in KV with an optional TTL.
   *
   * Snapshots are serialized as JSON and stored with a TTL.
   * Stale snapshots (old versions) will expire naturally based on their TTL.
   *
   * The TTL should be computed dynamically based on pending publish/unpublish transitions
   * to ensure the cache expires before content changes. Use computeDynamicTTL from
   * @/scheduling/ttl.service to compute the appropriate TTL.
   *
   * @param kv - KV namespace binding
   * @param key - Versioned or unversioned key
   * @param data - Snapshot data to serialize
   * @param ttl - Time-to-live in seconds (should be computed dynamically)
   */
  async putSnapshot(
    kv: KVNamespace,
    key: string,
    data: unknown,
    ttl: number,
    namespace: CacheNamespace = CACHE_NAMESPACE.CONTENT
  ): Promise<void> {
    inFlightKVReads.delete(key)
    inFlightGetOrSet.delete(key)
    // Clamp TTL between min (60s) and max (3600s) for safety
    const boundedTTL = Math.max(60, Math.min(ttl, 3600))
    // Stringify once: the same payload serves KV and LRU size accounting.
    const serialized = JSON.stringify(data)
    await kv.put(key, serialized, { expirationTtl: boundedTTL })
    writeFrozenMemorySnapshot(key, data, getMemoryTTL(namespace), serialized.length * 2)
  },

  /**
   * Delete a snapshot from KV.
   *
   * Note: This is rarely needed since versioned invalidation makes keys stale
   * without deletion. Use this for hard cleanup scenarios only.
   *
   * @param kv - KV namespace binding
   * @param key - Versioned or unversioned key
   */
  async deleteSnapshot(kv: KVNamespace, key: string): Promise<void> {
    inFlightKVReads.delete(key)
    inFlightGetOrSet.delete(key)
    await kv.delete(key)
    memorySnapshotCache.delete(key)
  },

  /**
   * Get a value from cache or compute it using the factory function.
   *
   * This is a cache-aside helper that checks the cache first, and if not found,
   * calls the factory function to compute the value, stores it in cache, and returns it.
   *
   * @param kv - KV namespace binding
   * @param key - Cache key
   * @param factory - Async function to compute the value if not cached
   * @param ttl - Time-to-live in seconds
   * @param namespace - Cache namespace for memory cache TTL
   * @param tracker - Optional cache metadata tracker
   * @returns The cached or computed value, or null if factory returns null
   */
  async getOrSet<T>(
    kv: KVNamespace,
    key: string,
    factory: () => Promise<T | null>,
    ttl: number,
    namespace: CacheNamespace = CACHE_NAMESPACE.CONTENT,
    tracker?: CacheMetadataTracker
  ): Promise<T | null> {
    const inFlightEarly = inFlightGetOrSet.get(key)
    if (inFlightEarly) {
      return inFlightEarly as Promise<T | null>
    }

    const cached = await this.getSnapshot(kv, key, tracker, namespace)
    if (cached !== null) {
      return cached as T
    }

    const inFlight = inFlightGetOrSet.get(key)
    if (inFlight) {
      return inFlight as Promise<T | null>
    }

    const promise = (async () => {
      try {
        const fresh = await factory()
        if (fresh === null || fresh === undefined) {
          return null
        }
        await this.putSnapshot(kv, key, fresh, ttl, namespace)
        return fresh
      } finally {
        inFlightGetOrSet.delete(key)
      }
    })()

    inFlightGetOrSet.set(key, promise)
    return promise
  },
}
