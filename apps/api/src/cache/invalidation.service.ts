import type { Database } from '@/database/db'
import { entriesRepository } from '@/entries/entries.repository'
import { logger } from '@/observability/logger'
import { kvService } from './kv.service'
import { snapshotService } from './snapshot.service'

/**
 * Cache Invalidation Service — Tag-based invalidation for content snapshots.
 *
 * This service coordinates cache invalidation triggered by command execution.
 * When content changes (e.g., entry updated, relation linked), the engine calls
 * this service with relevant cache tags, and all affected snapshots are invalidated.
 *
 * Invalidation strategy:
 * 1. Look up all snapshot keys associated with each tag (via cache_tags table)
 * 2. Parse the base key and extract collectionSlug/locale
 * 3. Increment the version counter for that collection+locale
 * 4. Old versioned keys become stale; next read will generate a new snapshot
 *
 * This approach avoids physically deleting keys — KV handles stale key cleanup via TTL.
 */

/**
 * Extract tenant slug, collection slug, and locale from a snapshot key.
 *
 * Snapshot keys follow these patterns:
 * - Single-tenant: `snapshot:{collectionSlug}:{locale}:list`
 * - Multi-tenant: `{tenantSlug}:snapshot:{collectionSlug}:{locale}:list`
 *
 * @param snapshotKey - Base snapshot key (may have tenant and/or version prefix)
 * @returns Object with tenantSlug, collectionSlug, and locale, or null if parsing fails
 */
function parseSnapshotKey(snapshotKey: string): {
  tenantSlug?: string
  collectionSlug: string
  locale: string
} | null {
  let key = snapshotKey

  // Remove version prefix if present at the start
  // Patterns: 'v1:snapshot:...' or 'acme:v1:snapshot:...'
  if (key.match(/^v\d+:/)) {
    // Single-tenant versioned: 'v1:snapshot:...'
    key = key.replace(/^v\d+:/, '')
  } else if (key.match(/^[^:]+:v\d+:/)) {
    // Multi-tenant versioned: 'acme:v1:snapshot:...'
    key = key.replace(/:v\d+:/, ':')
  }

  // Now parse: either 'snapshot:...' or 'tenantSlug:snapshot:...'
  const parts = key.split(':')
  if (!parts || parts.length < 4) {
    return null
  }

  let tenantSlug: string | undefined
  let startIdx = 0

  // If first part is not 'snapshot', it's a tenant slug
  if (parts[0] !== 'snapshot') {
    tenantSlug = parts[0]
    startIdx = 1
  }

  // Now parse: snapshot:{collectionSlug}:{locale}:...
  if (parts[startIdx] !== 'snapshot' || !parts[startIdx + 1] || !parts[startIdx + 2]) {
    return null
  }

  return {
    tenantSlug,
    collectionSlug: parts[startIdx + 1] as string,
    locale: parts[startIdx + 2] as string,
  }
}

/**
 * Invalidate all snapshots associated with the given cache tags.
 *
 * For each tag:
 * 1. Query cache_tags table for all associated snapshot keys
 * 2. Parse keys to extract collection+locale pairs
 * 3. Increment version counter for each unique collection+locale
 * 4. Return list of invalidated keys for logging/debugging
 *
 * Note: Invalidation failures are non-blocking. If KV write fails, the error
 * is logged but does not prevent command execution from succeeding.
 *
 * @param db - Database instance (for querying cache_tags)
 * @param kv - KV namespace binding (for incrementing version counters)
 * @param tags - Array of cache tags (e.g., 'collection:articles', 'entry:abc123')
 * @returns Object with list of invalidated snapshot keys
 */
export async function invalidateByTags(
  db: Database,
  kv: KVNamespace,
  tags: string[]
): Promise<{ invalidatedKeys: string[] }> {
  if (tags.length === 0) {
    return { invalidatedKeys: [] }
  }

  // Step 1: Collect all unique snapshot keys affected by these tags
  const affectedKeys = new Set<string>()
  for (const tag of tags) {
    const keys = await snapshotService.getSnapshotKeysByTag(db, tag)
    for (const key of keys) {
      affectedKeys.add(key)
    }
  }

  // Step 2: Parse keys to extract unique tenant+collection+locale tuples
  const tuples = new Set<string>()
  const parsedKeyCache = new Map<string, ReturnType<typeof parseSnapshotKey>>()
  for (const key of affectedKeys) {
    const parsed = parseSnapshotKey(key)
    parsedKeyCache.set(key, parsed)
    if (parsed) {
      const tuple = parsed.tenantSlug
        ? `${parsed.tenantSlug}:${parsed.collectionSlug}:${parsed.locale}`
        : `${parsed.collectionSlug}:${parsed.locale}`
      tuples.add(tuple)
    }
  }

  // Step 3: Increment version counter for each tenant+collection+locale tuple
  const invalidatedKeys: string[] = []
  for (const tuple of tuples) {
    const parts = tuple.split(':')
    let tenantSlug: string | undefined
    let collectionSlug: string
    let locale: string

    if (parts.length === 3) {
      // Multi-tenant: tenantSlug:collectionSlug:locale
      tenantSlug = parts[0]
      collectionSlug = parts[1] as string
      locale = parts[2] as string
    } else if (parts.length === 2) {
      // Single-tenant: collectionSlug:locale
      collectionSlug = parts[0] as string
      locale = parts[1] as string
    } else {
      continue
    }

    try {
      await kvService.incrementVersion(kv, collectionSlug, locale, tenantSlug)
      // Record all keys affected by this tuple for logging
      for (const key of affectedKeys) {
        const parsed = parsedKeyCache.get(key)
        if (
          parsed?.collectionSlug === collectionSlug &&
          parsed?.locale === locale &&
          parsed?.tenantSlug === tenantSlug
        ) {
          invalidatedKeys.push(key)
        }
      }
    } catch (err) {
      const logTuple = tenantSlug
        ? `${tenantSlug}:${collectionSlug}:${locale}`
        : `${collectionSlug}:${locale}`
      logger.error('cache_version_increment_failed', {
        tuple: logTuple,
        error: err instanceof Error ? err.message : String(err),
      })
      // Continue with remaining invalidations even if one fails
    }
  }

  return { invalidatedKeys }
}

/**
 * Extract cache tags from a command envelope for invalidation.
 *
 * Maps command types and payloads to the relevant cache tags that should
 * be invalidated after successful command execution.
 *
 * Tag generation rules:
 * - `createEntry` / `updateEntry` / `deleteEntry` → `collection:{collectionId}`, `entry:{entryId}`
 * - `publishNow` / `unpublishNow` / scheduled lifecycle commands → `entry:{entryId}`, `collection:{collectionId}`
 * - `linkRelation` / `unlinkRelation` → `entry:{sourceEntryId}`, `entry:{targetEntryId}`
 * - `bulkUpdate` → Tags for each affected entry
 * - `updateSingleton` → `collection:{collectionId}`
 * - `transaction` → No tags (sub-commands handle their own invalidation)
 *
 * @param commandType - Command type discriminant
 * @param payload - Command-specific payload
 * @param tenantId - Optional tenant scope for entry lookups
 * @returns Array of cache tag strings
 */
export async function extractCacheTagsFromCommand(
  db: Database,
  commandType: string,
  payload: Record<string, unknown>,
  tenantId?: string
): Promise<string[]> {
  const tags = new Set<string>()

  async function resolveCollectionId(): Promise<string | undefined> {
    if (payload.collectionId && typeof payload.collectionId === 'string') {
      return payload.collectionId
    }
    if (payload.entryId && typeof payload.entryId === 'string') {
      const entry = await entriesRepository.findById(db, payload.entryId, tenantId)
      return entry?.collectionId
    }
    if (Array.isArray(payload.entryIds) && payload.entryIds.length > 0) {
      const firstEntryId = payload.entryIds[0]
      if (typeof firstEntryId === 'string') {
        const entry = await entriesRepository.findById(db, firstEntryId, tenantId)
        return entry?.collectionId
      }
    }
    return undefined
  }

  switch (commandType) {
    case 'createEntry':
    case 'updateEntry':
    case 'deleteEntry': {
      const collectionId = await resolveCollectionId()
      if (collectionId) {
        tags.add(`collection:${collectionId}`)
      }
      if (payload.entryId && typeof payload.entryId === 'string') {
        tags.add(`entry:${payload.entryId}`)
      }
      break
    }

    case 'publishNow':
    case 'unpublishNow':
    case 'schedulePublish':
    case 'scheduleUnpublish':
    case 'cancelSchedule': {
      const collectionId = await resolveCollectionId()
      if (collectionId) {
        tags.add(`collection:${collectionId}`)
      }
      if (payload.entryId && typeof payload.entryId === 'string') {
        tags.add(`entry:${payload.entryId}`)
      }
      break
    }

    case 'linkRelation':
    case 'unlinkRelation': {
      if (payload.sourceEntryId && typeof payload.sourceEntryId === 'string') {
        tags.add(`entry:${payload.sourceEntryId}`)
      }
      if (payload.targetEntryId && typeof payload.targetEntryId === 'string') {
        tags.add(`entry:${payload.targetEntryId}`)
      }
      break
    }

    case 'bulkUpdate': {
      if (Array.isArray(payload.entryIds)) {
        for (const entryId of payload.entryIds) {
          if (typeof entryId === 'string') {
            tags.add(`entry:${entryId}`)
          }
        }
      }

      const collectionId = await resolveCollectionId()
      if (collectionId) {
        tags.add(`collection:${collectionId}`)
      }
      break
    }

    case 'updateSingleton': {
      if (payload.collectionId && typeof payload.collectionId === 'string') {
        tags.add(`collection:${payload.collectionId}`)
      }
      break
    }

    case 'transaction':
      // Transaction commands don't have direct tags — sub-commands handle invalidation
      break

    default:
      // Unknown command type — no tags
      break
  }

  return [...tags]
}
