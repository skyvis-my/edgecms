import { and, desc, eq, gt, inArray, isNull, like, lte, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { publicEntryStatuses } from '@/shared/schemas/entry'
import { collections, entries, entryVersions } from '@/database/schema'

/** Row type inferred from the entries table. */
export type EntryRow = typeof entries.$inferSelect

/** Insert type inferred from the entries table. */
export type EntryInsert = typeof entries.$inferInsert

/** Row type inferred from the entry_versions table. */
export type EntryVersionRow = typeof entryVersions.$inferSelect

/** Insert type inferred from the entry_versions table. */
export type EntryVersionInsert = typeof entryVersions.$inferInsert

/** Filters for listing entries. */
export interface EntryFilters {
  collectionId?: string
  collectionSlug?: string
  tenantId?: string
  status?: string
  page?: number
  perPage?: number
  extraConditions?: SQL[]
  orderByClause?: SQL
  skipCount?: boolean
}

/** Filters for listing publicly visible entries at request time. */
export interface PublicVisibilityFilters {
  collectionId: string
  page?: number
  perPage?: number
  now?: string
  extraConditions?: SQL[]
  orderByClause?: SQL
  skipCount?: boolean
}

function buildPublicVisibilityConditions(now: string): SQL[] {
  return [
    inArray(entries.status, publicEntryStatuses),
    or(isNull(entries.publishAt), lte(entries.publishAt, now))!,
    or(isNull(entries.unpublishAt), gt(entries.unpublishAt, now))!,
  ]
}

function resolveTenantScope(tenantId?: string): string {
  return tenantId ?? 'global'
}

/**
 * Data access layer for the entries and entry_versions tables.
 *
 * Every method receives a Drizzle DB instance as its first argument
 * (dependency injection) so callers can pass in the request-scoped
 * database connection created from the D1 binding.
 */
export const entriesRepository = {
  /** List entries with optional filtering and pagination. */
  async findAll(
    db: Database,
    filters: EntryFilters = {}
  ): Promise<{ rows: EntryRow[]; total: number }> {
    const {
      collectionId,
      status,
      tenantId,
      page = 1,
      perPage = 20,
      extraConditions = [],
      orderByClause,
    } = filters
    const safePage = Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1)
    const safePerPage = Math.min(100, Math.max(1, Number.isFinite(perPage) ? Math.floor(perPage) : 20))
    // Always tenant-scope admin reads. Missing tenantId falls back to the
    // 'global' scope (never an unscoped cross-tenant read).
    const tenantScope = resolveTenantScope(tenantId)
    const conditions = [eq(collections.tenantId, tenantScope)]

    if (collectionId) {
      conditions.push(eq(entries.collectionId, collectionId))
    }
    if (status) {
      conditions.push(eq(entries.status, status))
    }

    // Add extra conditions from query filters
    conditions.push(...extraConditions)

    const where = and(...conditions)
    const offset = (safePage - 1) * safePerPage

    const runRows = async (): Promise<EntryRow[]> => {
      const baseQuery = db
        .select({ entry: entries })
        .from(entries)
        .innerJoin(collections, eq(collections.id, entries.collectionId))
        .where(where)
      const orderedQuery = orderByClause
        ? baseQuery.orderBy(orderByClause)
        : baseQuery.orderBy(desc(entries.createdAt))
      return (await orderedQuery.limit(safePerPage).offset(offset)).map(
        (row) => (row as unknown as { entry: EntryRow }).entry
      )
    }

    // Count + rows in parallel (count skipped when caller sets skipCount).
    const [countRows, rows] = await Promise.all([
      filters.skipCount
        ? Promise.resolve(null)
        : db
            .select({ count: sql<number>`count(*)` })
            .from(entries)
            .innerJoin(collections, eq(collections.id, entries.collectionId))
            .where(where),
      runRows(),
    ])
    const total = filters.skipCount ? -1 : (countRows?.[0]?.count ?? 0)

    return { rows, total }
  },

  /** List entries that are publicly visible at the provided time (or now). */
  async findVisibleByCollection(
    db: Database,
    filters: PublicVisibilityFilters
  ): Promise<{ rows: EntryRow[]; total: number }> {
    const {
      collectionId,
      page = 1,
      perPage = 20,
      now = new Date().toISOString(),
      extraConditions = [],
      orderByClause,
    } = filters

    const safePage = Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1)
    const safePerPage = Math.min(100, Math.max(1, Number.isFinite(perPage) ? Math.floor(perPage) : 20))

    const baseConditions = [
      eq(entries.collectionId, collectionId),
      ...buildPublicVisibilityConditions(now),
    ]

    const where = and(...baseConditions, ...extraConditions)
    const offset = (safePage - 1) * safePerPage

    const runRows = async (): Promise<EntryRow[]> => {
      const query = db
        .select()
        .from(entries)
        .where(where)
        .limit(safePerPage)
        .offset(offset)
      return orderByClause
        ? await query.orderBy(orderByClause)
        : await query.orderBy(desc(entries.createdAt))
    }

    const [countResult, rows] = await Promise.all([
      filters.skipCount
        ? Promise.resolve(null)
        : db.select({ count: sql<number>`count(*)` }).from(entries).where(where),
      runRows(),
    ])
    const total = filters.skipCount ? -1 : (countResult?.[0]?.count ?? 0)

    return { rows, total }
  },

  /** Find a single entry by its primary key. */
  async findById(db: Database, id: string, tenantId?: string): Promise<EntryRow | undefined> {
    const tenantScope = resolveTenantScope(tenantId)
    const rows = await db
      .select({ entry: entries })
      .from(entries)
      .innerJoin(collections, eq(collections.id, entries.collectionId))
      .where(and(eq(entries.id, id), eq(collections.tenantId, tenantScope)))
      .limit(1)
    return rows[0]?.entry
  },

  /** Find an entry by collection ID and slug. */
  async findByCollectionAndSlug(
    db: Database,
    collectionId: string,
    slug: string,
    tenantId?: string
  ): Promise<EntryRow | undefined> {
    const tenantScope = resolveTenantScope(tenantId)
    const rows = await db
      .select({ entry: entries })
      .from(entries)
      .innerJoin(collections, eq(collections.id, entries.collectionId))
      .where(
        and(
          eq(entries.collectionId, collectionId),
          eq(entries.slug, slug),
          eq(collections.tenantId, tenantScope)
        )
      )
      .limit(1)
    return rows[0]?.entry
  },

  /** Find multiple entries by ID using a single query, scoped to a tenant. */
  async findByIds(db: Database, ids: string[], tenantId?: string): Promise<EntryRow[]> {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) {
      return []
    }
    // Cap both paths to avoid unbounded IN scans (matches MAX_IN_VALUES=50 convention).
    if (uniqueIds.length > 100) {
      throw new Error('Maximum 100 IDs per batch request')
    }
    // Always tenant-scope batch reads. Missing tenantId falls back to the
    // 'global' scope (never an unscoped cross-tenant read).
    const tenantScope = resolveTenantScope(tenantId)
    const rows = await db
      .select({ entry: entries })
      .from(entries)
      .innerJoin(collections, eq(entries.collectionId, collections.id))
      .where(and(inArray(entries.id, uniqueIds), eq(collections.tenantId, tenantScope)))
      .limit(100)
    return rows.map((r) => r.entry)
  },

  /** Insert a new entry row. */
  async create(db: Database, data: EntryInsert): Promise<EntryRow> {
    const rows = await db.insert(entries).values(data).returning()
    const row = rows[0]
    if (!row) {
      throw new Error('Failed to create entry: insert returned no rows')
    }
    return row
  },

  /** Update an existing entry by ID. Returns the updated row or undefined if not found. */
  async update(
    db: Database,
    id: string,
    data: Partial<Omit<EntryInsert, 'id'>>,
    tenantId?: string
  ): Promise<EntryRow | undefined> {
    // Single-statement tenant-scoped update (no read-then-write round-trip).
    if (tenantId) {
      const rows = await db
        .update(entries)
        .set(data)
        .where(
          and(
            eq(entries.id, id),
            sql`EXISTS (SELECT 1 FROM ${collections} WHERE ${collections.id} = ${entries.collectionId} AND ${collections.tenantId} = ${tenantId})`
          )
        )
        .returning()
      return rows[0]
    }
    const rows = await db.update(entries).set(data).where(eq(entries.id, id)).returning()
    return rows[0]
  },

  /**
   * Compare-and-swap update by entry id and expected version.
   * Returns undefined when no row matches (deleted or version conflict).
   */
  async updateWithVersion(
    db: Database,
    id: string,
    expectedVersion: number,
    data: Partial<Omit<EntryInsert, 'id'>>,
    tenantId?: string
  ): Promise<EntryRow | undefined> {
    if (tenantId) {
      const rows = await db
        .update(entries)
        .set(data)
        .where(
          and(
            eq(entries.id, id),
            eq(entries.version, expectedVersion),
            sql`EXISTS (SELECT 1 FROM ${collections} WHERE ${collections.id} = ${entries.collectionId} AND ${collections.tenantId} = ${tenantId})`
          )
        )
        .returning()
      return rows[0]
    }
    const rows = await db
      .update(entries)
      .set(data)
      .where(and(eq(entries.id, id), eq(entries.version, expectedVersion)))
      .returning()
    return rows[0]
  },

  /** Delete an entry by ID. Returns true if a row was deleted. */
  async deleteById(db: Database, id: string, tenantId?: string): Promise<boolean> {
    if (tenantId) {
      const rows = await db
        .delete(entries)
        .where(
          and(
            eq(entries.id, id),
            sql`EXISTS (SELECT 1 FROM ${collections} WHERE ${collections.id} = ${entries.collectionId} AND ${collections.tenantId} = ${tenantId})`
          )
        )
        .returning({ id: entries.id })
      return rows.length > 0
    }
    const rows = await db.delete(entries).where(eq(entries.id, id)).returning({ id: entries.id })
    return rows.length > 0
  },

  /** Create a version snapshot in the entry_versions table. */
  async createVersion(db: Database, data: EntryVersionInsert): Promise<EntryVersionRow> {
    const rows = await db.insert(entryVersions).values(data).returning()
    const row = rows[0]
    if (!row) {
      throw new Error('Failed to create entry version: insert returned no rows')
    }
    return row
  },

  /** List version history for an entry. */
  async findVersions(
    db: Database,
    entryId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<EntryVersionRow[]> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 50))
    const offset = Math.max(0, options.offset ?? 0)
    return db
      .select()
      .from(entryVersions)
      .where(eq(entryVersions.entryId, entryId))
      .orderBy(desc(entryVersions.version))
      .limit(limit)
      .offset(offset)
  },

  /** List version metadata (excluding `data` JSON payloads) for retention pruning. */
  async findVersionMetadata(
    db: Database,
    entryId: string,
    options: { limit?: number } = {}
  ): Promise<Array<Pick<EntryVersionRow, 'id' | 'entryId' | 'version' | 'createdBy' | 'createdAt'>>> {
    const limit = Math.min(500, Math.max(1, options.limit ?? 200))
    return db
      .select({
        id: entryVersions.id,
        entryId: entryVersions.entryId,
        version: entryVersions.version,
        createdBy: entryVersions.createdBy,
        createdAt: entryVersions.createdAt,
      })
      .from(entryVersions)
      .where(eq(entryVersions.entryId, entryId))
      .orderBy(desc(entryVersions.version))
      .limit(limit)
  },

  /** Find existing entry slugs with a prefix (single LIKE query; suffix resolved in memory). */
  async findSlugsByPrefix(
    db: Database,
    collectionId: string,
    slugPrefix: string,
    tenantId?: string
  ): Promise<string[]> {
    const escaped = slugPrefix.replace(/[%_\\]/g, (c) => `\\${c}`)
    const conds = [eq(entries.collectionId, collectionId), like(entries.slug, `${escaped}%`)]
    if (tenantId) {
      const rows = await db
        .select({ slug: entries.slug })
        .from(entries)
        .innerJoin(collections, eq(collections.id, entries.collectionId))
        .where(and(...conds, eq(collections.tenantId, tenantId)))
        .limit(100)
      return rows.map((r) => r.slug)
    }
    const rows = await db
      .select({ slug: entries.slug })
      .from(entries)
      .where(and(...conds))
      .limit(100)
    return rows.map((r) => r.slug)
  },

  /** Find a specific version by its version ID. */
  async findVersionById(db: Database, versionId: string): Promise<EntryVersionRow | undefined> {
    const rows = await db
      .select()
      .from(entryVersions)
      .where(eq(entryVersions.id, versionId))
      .limit(1)
    return rows[0]
  },
}
