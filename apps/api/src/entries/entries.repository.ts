import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
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
}

/** Filters for listing publicly visible entries at request time. */
export interface PublicVisibilityFilters {
  collectionId: string
  page?: number
  perPage?: number
  now?: string
  extraConditions?: SQL[]
  orderByClause?: SQL
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
    const { collectionId, status, tenantId, page = 1, perPage = 20, extraConditions = [], orderByClause } = filters
    const conditions = []

    if (collectionId) {
      conditions.push(eq(entries.collectionId, collectionId))
    }
    if (status) {
      conditions.push(eq(entries.status, status))
    }
    if (tenantId) {
      conditions.push(eq(collections.tenantId, tenantId))
    }

    // Add extra conditions from query filters
    conditions.push(...extraConditions)

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const offset = (page - 1) * perPage

    // Get total count
    const countResult = tenantId
      ? await db
          .select({ count: sql<number>`count(*)` })
          .from(entries)
          .innerJoin(collections, eq(collections.id, entries.collectionId))
          .where(where)
      : await db.select({ count: sql<number>`count(*)` }).from(entries).where(where)
    const total = countResult[0]?.count ?? 0

    // Build base query for rows
    const baseQuery = tenantId
      ? db
          .select({ entry: entries })
          .from(entries)
          .innerJoin(collections, eq(collections.id, entries.collectionId))
          .where(where)
      : db.select().from(entries).where(where)

    // Apply order by clause
    const orderedQuery = orderByClause
      ? baseQuery.orderBy(orderByClause)
      : baseQuery.orderBy(desc(entries.createdAt))

    // Get paginated rows
    const rows = tenantId
      ? (await orderedQuery.limit(perPage).offset(offset)).map((row) => (row as unknown as { entry: EntryRow }).entry)
      : (await orderedQuery.limit(perPage).offset(offset)) as EntryRow[]

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

    const baseConditions = [
      eq(entries.collectionId, collectionId),
      ...buildPublicVisibilityConditions(now),
    ]

    const where = and(...baseConditions, ...extraConditions)
    const offset = (page - 1) * perPage

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(entries)
      .where(where)
    const total = countResult[0]?.count ?? 0

    const query = db
      .select()
      .from(entries)
      .where(where)
      .limit(perPage)
      .offset(offset)

    const rows = orderByClause
      ? await query.orderBy(orderByClause)
      : await query.orderBy(desc(entries.createdAt))

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
    if (ids.length === 0) {
      return []
    }
    if (!tenantId) {
      return db.select().from(entries).where(inArray(entries.id, ids))
    }
    const rows = await db
      .select({ entry: entries })
      .from(entries)
      .innerJoin(collections, eq(entries.collectionId, collections.id))
      .where(and(inArray(entries.id, ids), eq(collections.tenantId, tenantId)))
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
    data: Partial<Omit<EntryInsert, 'id'>>
  ): Promise<EntryRow | undefined> {
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
    data: Partial<Omit<EntryInsert, 'id'>>
  ): Promise<EntryRow | undefined> {
    const rows = await db
      .update(entries)
      .set(data)
      .where(and(eq(entries.id, id), eq(entries.version, expectedVersion)))
      .returning()
    return rows[0]
  },

  /** Delete an entry by ID. Returns true if a row was deleted. */
  async deleteById(db: Database, id: string): Promise<boolean> {
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
  async findVersions(db: Database, entryId: string): Promise<EntryVersionRow[]> {
    return db
      .select()
      .from(entryVersions)
      .where(eq(entryVersions.entryId, entryId))
      .orderBy(desc(entryVersions.version))
  },
}
