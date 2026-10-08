import { and, eq, like } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { collections } from '@/database/schema'

/** Row type inferred from the collections table. */
export type CollectionRow = typeof collections.$inferSelect

/** Insert type inferred from the collections table. */
export type CollectionInsert = typeof collections.$inferInsert

function resolveTenantScope(tenantId?: string): string {
  return tenantId ?? 'global'
}

/**
 * Data access layer for the collections table.
 *
 * Every method receives a Drizzle DB instance as its first argument
 * (dependency injection) so callers can pass in the request-scoped
 * database connection created from the D1 binding.
 */
export const collectionsRepository = {
  /** List all collections ordered by creation date (newest first). */
  async findAll(db: Database, tenantId?: string): Promise<CollectionRow[]> {
    const tenantScope = resolveTenantScope(tenantId)
    return db.select().from(collections).where(eq(collections.tenantId, tenantScope)).all()
  },

  /** Find a single collection by its primary key. */
  async findById(db: Database, id: string, tenantId?: string): Promise<CollectionRow | undefined> {
    const tenantScope = resolveTenantScope(tenantId)
    const condition = and(eq(collections.id, id), eq(collections.tenantId, tenantScope))
    const rows = await db.select().from(collections).where(condition).limit(1)
    return rows[0]
  },

  /** Find a single collection by its unique slug. */
  async findBySlug(
    db: Database,
    slug: string,
    tenantId?: string
  ): Promise<CollectionRow | undefined> {
    const tenantScope = resolveTenantScope(tenantId)
    const condition = and(eq(collections.slug, slug), eq(collections.tenantId, tenantScope))
    const rows = await db.select().from(collections).where(condition).limit(1)
    return rows[0]
  },

  /** Find existing slugs matching a base slug prefix. */
  async findSlugsByPrefix(db: Database, slugPrefix: string, tenantId?: string): Promise<string[]> {
    const escapedPrefix = slugPrefix.replace(/[%_]/g, (char) => `\\${char}`)
    const pattern = `${escapedPrefix}%`
    const tenantScope = resolveTenantScope(tenantId)
    const condition = and(eq(collections.tenantId, tenantScope), like(collections.slug, pattern))
    const rows = await db.select({ slug: collections.slug }).from(collections).where(condition)
    return rows.map((row) => row.slug)
  },

  /** Insert a new collection row. */
  async create(db: Database, data: CollectionInsert): Promise<CollectionRow> {
    const rows = await db.insert(collections).values(data).returning()
    const created = rows[0]
    if (!created) {
      throw new Error('Failed to create collection')
    }
    return created
  },

  /** Update an existing collection by ID. Returns the updated row or undefined if not found. */
  async update(
    db: Database,
    id: string,
    data: Partial<Omit<CollectionInsert, 'id'>>,
    tenantId?: string
  ): Promise<CollectionRow | undefined> {
    const tenantScope = resolveTenantScope(tenantId)
    const condition = and(eq(collections.id, id), eq(collections.tenantId, tenantScope))
    const rows = await db.update(collections).set(data).where(condition).returning()
    return rows[0]
  },

  /** Delete a collection by ID. Returns true if a row was deleted. */
  async deleteById(db: Database, id: string, tenantId?: string): Promise<boolean> {
    const tenantScope = resolveTenantScope(tenantId)
    const condition = and(eq(collections.id, id), eq(collections.tenantId, tenantScope))
    const rows = await db
      .delete(collections)
      .where(condition)
      .returning({ id: collections.id })
    return rows.length > 0
  },
}
