import { eq, inArray, type SQL } from 'drizzle-orm'
import { collectionsRepository } from '@/collections/collections.repository'
import type { Database } from '@/database/db'
import { cacheTags } from '@/database/schema'
import { entriesRepository, type EntryRow } from '@/entries/entries.repository'
import { relationsResolver, type PopulatedEntry } from '@/relations/relations.resolver'
import { flattenLocaleFields } from '@/shared/locale'

/**
 * List snapshot structure returned by generateListSnapshot.
 * Contains all published entries for a collection, localized to a specific locale.
 */
export interface ListSnapshot {
  collection: {
    id: string
    name: string
    slug: string
  }
  locale: string
  entries: Array<{
    id: string
    slug: string
    data: Record<string, unknown>
    version: number
    createdAt: string
    updatedAt: string
  }>
  generatedAt: string
  total: number
  tenantId?: string
  cache?: SnapshotCacheTtls
}

/**
 * Entry snapshot structure returned by generateEntrySnapshot.
 * Contains a single published entry with resolved relations, localized to a specific locale.
 */
export interface EntrySnapshot {
  collection: {
    id: string
    name: string
    slug: string
  }
  locale: string
  entry: {
    id: string
    slug: string
    data: Record<string, unknown>
    version: number
    createdAt: string
    updatedAt: string
  }
  generatedAt: string
  tenantId?: string
  cache?: SnapshotCacheTtls
}

/**
 * Header TTLs embedded in a snapshot on write so KV-hit responses can reuse
 * them without recomputing (avoids D1 reads on the hot path).
 */
export interface SnapshotCacheTtls {
  dynamicTTL: number
  browserTTL: number
  cdnTTL: number
}

export type CollectionSnapshotSeed = {
  id: string
  slug: string
  name: string
  fields: Array<{ name: string; localizable: boolean }>
  defaultLocale: string
}

/**
 * Populate relations for a single entry via the batch populateMany API.
 * Even for one entry this avoids the per-target sequential recursion of
 * populate(): nested relations resolve across all targets per depth level.
 */
async function populateSingleEntry(
  db: Database,
  entry: EntryRow,
  fieldNames: string[],
  maxDepth: number,
  tenantId?: string
): Promise<PopulatedEntry> {
  if (typeof relationsResolver.populateMany === 'function') {
    const [populated] = await relationsResolver.populateMany(
      db,
      [entry],
      fieldNames,
      1,
      maxDepth,
      new Set(),
      tenantId,
      true
    )
    return populated ?? entry
  }
  return relationsResolver.populate(db, entry, fieldNames, 1, maxDepth, new Set(), tenantId, true)
}

function isEntryVisibleAtRequestTime(
  entry: {
    status: string
    publishAt?: string | null
    unpublishAt?: string | null
  },
  nowIso: string
): boolean {
  // Never expose authoring-only states publicly.
  if (entry.status === 'draft' || entry.status === 'archived') {
    return false
  }

  if (entry.publishAt && entry.publishAt > nowIso) {
    return false
  }

  if (entry.unpublishAt && entry.unpublishAt <= nowIso) {
    return false
  }

  return true
}

/**
 * Snapshot generation service for creating pre-computed JSON snapshots
 * of published content with resolved relations and localized fields.
 *
 * These snapshots are designed to be stored in KV for fast public API access.
 */
export const snapshotService = {
  async getCollectionContext(
    db: Database,
    collectionSlug: string,
    tenantId: string | undefined,
    preloadedCollection?: CollectionSnapshotSeed
  ): Promise<CollectionSnapshotSeed | null> {
    if (preloadedCollection) {
      return preloadedCollection
    }

    const collection = await collectionsRepository.findBySlug(db, collectionSlug, tenantId)
    return collection ?? null
  },

  /**
   * Generate a list snapshot of all published entries in a collection.
   *
   * This snapshot includes:
   * - Collection metadata (id, name, slug)
   * - All published entries with localized fields flattened to the target locale
   * - Relations resolved to depth 1
   * - Total count and generation timestamp
   *
   * @param db - Database instance
   * @param collectionSlug - Slug of the collection to generate snapshot for
   * @param locale - Locale to flatten localized fields to
   * @param tenantId - Optional tenant ID for tenant context metadata
   * @returns List snapshot structure ready for KV storage
   */
  async generateListSnapshot(
    db: Database,
    collectionSlug: string,
    locale: string,
    tenantId?: string,
    pagination?: { page?: number; perPage?: number },
    queryOptions?: {
      extraConditions?: SQL[]
      orderByClause?: SQL
    },
    collection?: CollectionSnapshotSeed
  ): Promise<ListSnapshot | null> {
    const collectionContext = await snapshotService.getCollectionContext(
      db,
      collectionSlug,
      tenantId,
      collection
    )

    const collectionData = collectionContext
    if (!collectionData) {
      return null
    }

    const { rows: visibleEntries } = await entriesRepository.findVisibleByCollection(db, {
      collectionId: collectionData.id,
      page: Math.max(1, pagination?.page ?? 1),
      perPage: Math.min(100, Math.max(1, pagination?.perPage ?? 20)),
      skipCount: true,
      ...queryOptions,
    })

    // Resolve relation fields in batch across all visible entries (depth 1 for list snapshots)
    const populatedEntries =
      typeof relationsResolver.populateMany === 'function'
        ? await relationsResolver.populateMany(
            db,
            visibleEntries,
            [],
            1,
            1,
            new Set(),
            tenantId,
            true
          )
        : await Promise.all(
            visibleEntries.map((entry) =>
              relationsResolver.populate(db, entry, [], 1, 1, new Set(), tenantId, true)
            )
          )

    // Flatten localized fields to the target locale
    const processedEntries = populatedEntries.map((populated) => {
      const flattenedData = flattenLocaleFields(
        populated.data,
        collectionData.fields,
        locale,
        collectionData.defaultLocale
      )

      return {
        id: populated.id,
        slug: populated.slug,
        data: flattenedData,
        version: populated.version,
        createdAt: populated.createdAt,
        updatedAt: populated.updatedAt,
      }
    })

    return {
      collection: {
        id: collectionData.id,
        name: collectionData.name,
        slug: collectionData.slug,
      },
      locale,
      entries: processedEntries,
      generatedAt: new Date().toISOString(),
      total: processedEntries.length,
      ...(tenantId && { tenantId }),
    }
  },

  /**
   * Generate a single entry snapshot with full detail.
   *
   * This snapshot includes:
   * - Collection metadata (id, name, slug)
   * - Single published entry with localized fields flattened to the target locale
   * - Relations resolved to depth 2 (more detail than list snapshots)
   * - Generation timestamp
   *
   * @param db - Database instance
   * @param collectionSlug - Slug of the collection
   * @param entryIdOrSlug - Entry ID or slug to generate snapshot for
   * @param locale - Locale to flatten localized fields to
   * @param tenantId - Optional tenant ID for tenant context metadata
   * @returns Entry snapshot structure ready for KV storage, or null if not found
   */
  async generateEntrySnapshot(
    db: Database,
    collectionSlug: string,
    entryIdOrSlug: string,
    locale: string,
    tenantId?: string,
    queryPattern?: {
      populate?: string[]
      depth?: number
    },
    collection?: CollectionSnapshotSeed
  ): Promise<EntrySnapshot | null> {
    const collectionData = await snapshotService.getCollectionContext(
      db,
      collectionSlug,
      tenantId,
      collection
    )
    if (!collectionData) {
      return null
    }

    // Lookup: UUIDs prefer findById, slugs prefer slug lookup (1 query on hit),
    // with a miss fallback for legacy short ids. Non-UUID callers (e.g. "e1"
    // in tests, singleton entry.id which is a UUID) resolve in one trip.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const isUuid = UUID_RE.test(entryIdOrSlug)
    let entry = isUuid
      ? await entriesRepository.findById(db, entryIdOrSlug, tenantId)
      : await entriesRepository.findByCollectionAndSlug(
          db,
          collectionData.id,
          entryIdOrSlug,
          tenantId
        )
    if (!entry) {
      // Miss fallback: the other shape (covers legacy short ids).
      entry = isUuid
        ? await entriesRepository.findByCollectionAndSlug(
            db,
            collectionData.id,
            entryIdOrSlug,
            tenantId
          )
        : await entriesRepository.findById(db, entryIdOrSlug, tenantId)
    }
    if (entry && entry.collectionId !== collectionData.id) {
      entry = undefined
    }

    if (!entry) {
      return null
    }

    if (!isEntryVisibleAtRequestTime(entry, new Date().toISOString())) {
      return null
    }

    let populated = entry
    if (queryPattern) {
      const maxDepth = Math.min(Math.max(queryPattern.depth ?? 1, 1), 3)
      const requestedFields = queryPattern.populate ?? []
      if (requestedFields.length > 0) {
        const relationFields =
          requestedFields.length === 1 && requestedFields[0] === '*' ? [] : requestedFields
        populated = await populateSingleEntry(db, entry, relationFields, maxDepth, tenantId)
      }
    } else {
      // Preserve historical behavior when no explicit query pattern is provided.
      populated = await populateSingleEntry(db, entry, [], 2, tenantId)
    }

    // Flatten localized fields to the target locale
    const flattenedData = flattenLocaleFields(
      populated.data,
      collectionData.fields,
      locale,
      collectionData.defaultLocale
    )

    return {
      collection: {
        id: collectionData.id,
        name: collectionData.name,
        slug: collectionData.slug,
      },
      locale,
      entry: {
        id: entry.id,
        slug: entry.slug,
        data: flattenedData,
        version: entry.version,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
      generatedAt: new Date().toISOString(),
      ...(tenantId && { tenantId }),
    }
  },

  /**
   * Generate cache tag strings for a snapshot.
   *
   * Cache tags enable tag-based invalidation. When content changes,
   * we can identify all affected snapshots by their tags and invalidate them.
   *
   * Tags generated:
   * - `collection:{collectionId}` — always included, for collection-wide invalidation
   * - `entry:{entryId}` — included for entry-specific snapshots
   * - `locale:{locale}` — included for locale-specific snapshots
   *
   * @param collectionId - Collection ID
   * @param entryId - Entry ID (optional, for entry-specific snapshots)
   * @param locale - Locale code (optional, for locale-specific snapshots)
   * @returns Array of cache tag strings
   */
  generateCacheTags(
    collectionId: string,
    entryId?: string,
    locale?: string,
    options?: { tenantId?: string; collectionSlug?: string }
  ): string[] {
    const tags = [`collection:${collectionId}`]

    if (options?.collectionSlug) {
      tags.push(`collection:${options.collectionSlug}`)
    }

    if (options?.tenantId) {
      tags.push(`t:${options.tenantId}:c:${collectionId}`)
      if (options?.collectionSlug) {
        tags.push(`t:${options.tenantId}:c:${options.collectionSlug}`)
      }
    }

    if (entryId) {
      tags.push(`entry:${entryId}`)
      if (options?.tenantId) {
        tags.push(`t:${options.tenantId}:e:${entryId}`)
      }
    }

    if (locale) {
      tags.push(`locale:${locale}`)
    }

    return tags
  },

  /**
   * Store cache tags in the database for a snapshot key.
   *
   * This method:
   * 1. Deletes existing cache_tags rows for this snapshotKey (to handle updates)
   * 2. Inserts new cache_tag rows for each tag
   *
   * @param db - Database instance
   * @param snapshotKey - KV key where the snapshot is stored
   * @param tags - Array of cache tag strings to associate with this snapshot
   */
  async storeCacheTags(db: Database, snapshotKey: string, tags: string[]): Promise<void> {
    const hasBatch = typeof (db as unknown as { batch?: unknown }).batch === 'function'
    const now = new Date().toISOString()
    const rows = tags.map((tag) => ({
      id: crypto.randomUUID(),
      tag,
      snapshotKey,
      createdAt: now,
    }))
    const deleteBuilder = db.delete(cacheTags).where(eq(cacheTags.snapshotKey, snapshotKey))
    if (rows.length === 0) {
      await deleteBuilder
      return
    }
    const insertBuilder = db.insert(cacheTags).values(rows)
    // Atomic replace when the driver supports batch; else sequential delete-then-insert.
    if (hasBatch) {
      await (db as unknown as { batch: (q: unknown[]) => Promise<unknown> }).batch([
        deleteBuilder,
        insertBuilder,
      ])
      return
    }
    // Delete existing cache tags for this snapshot key
    await deleteBuilder
    await insertBuilder
  },

  /**
   * Get all snapshot keys associated with a cache tag.
   *
   * This is used for cache invalidation: when content changes, we query
   * for all snapshots that have the relevant tag, and invalidate them from KV.
   *
   * @param db - Database instance
   * @param tag - Cache tag to query (e.g., 'collection:articles', 'entry:abc123')
   * @returns Array of unique snapshot keys
   */
  async getSnapshotKeysByTag(db: Database, tag: string): Promise<string[]> {
    const rows = await db
      .select({ snapshotKey: cacheTags.snapshotKey })
      .from(cacheTags)
      .where(eq(cacheTags.tag, tag))

    const uniqueKeys = new Set(rows.map((row) => row.snapshotKey))
    return Array.from(uniqueKeys)
  },

  /**
   * Get all snapshot keys associated with any of the provided cache tags in a single query.
   * Tags are chunked (50/query) to respect D1/SQLite variable limits.
   */
  async getSnapshotKeysByTags(db: Database, tags: string[]): Promise<string[]> {
    if (tags.length === 0) return []
    const uniqueKeys = new Set<string>()
    for (let i = 0; i < tags.length; i += 50) {
      const chunk = tags.slice(i, i + 50)
      const rows = await db
        .select({ snapshotKey: cacheTags.snapshotKey })
        .from(cacheTags)
        .where(inArray(cacheTags.tag, chunk))
      for (const row of rows) uniqueKeys.add(row.snapshotKey)
    }
    return Array.from(uniqueKeys)
  },
}
