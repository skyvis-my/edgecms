import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { relations } from '@/database/schema/relations.schema'

/** Row type inferred from the relations table. */
export type RelationRow = typeof relations.$inferSelect

/** Insert type inferred from the relations table. */
export type RelationInsert = typeof relations.$inferInsert

/**
 * Data access layer for the relations table.
 *
 * Every method receives a Drizzle DB instance as its first argument
 * (dependency injection) so callers can pass in the request-scoped
 * database connection created from the D1 binding.
 */
export const relationsRepository = {
  /** Create a new relation link. */
  async link(db: Database, data: RelationInsert): Promise<RelationRow> {
    const rows = await db.insert(relations).values(data).returning()
    if (!rows[0]) {
      throw new Error('Failed to create relation')
    }
    return rows[0]
  },

  /** Delete a relation by its primary key. */
  async unlink(db: Database, id: string, tenantId?: string): Promise<boolean> {
    const conditions = [eq(relations.id, id)]
    if (tenantId) {
      conditions.push(eq(relations.tenantId, tenantId))
    }
    const rows = await db
      .delete(relations)
      .where(and(...conditions))
      .returning({ id: relations.id })
    return rows.length > 0
  },

  /** Delete a relation by source entry, target entry, and field name. */
  async unlinkByEntries(
    db: Database,
    sourceEntryId: string,
    targetEntryId: string,
    fieldName: string,
    tenantId?: string
  ): Promise<boolean> {
    const conditions = [
      eq(relations.sourceEntryId, sourceEntryId),
      eq(relations.targetEntryId, targetEntryId),
      eq(relations.fieldName, fieldName),
    ]
    if (tenantId) {
      conditions.push(eq(relations.tenantId, tenantId))
    }
    const rows = await db
      .delete(relations)
      .where(and(...conditions))
      .returning({ id: relations.id })
    return rows.length > 0
  },

  /** Find all relations where the given entry is the source, optionally filtered by field. */
  async findBySourceEntry(
    db: Database,
    sourceEntryId: string,
    fieldName?: string,
    tenantId?: string
  ): Promise<RelationRow[]> {
    const conditions = [eq(relations.sourceEntryId, sourceEntryId)]
    if (fieldName) {
      conditions.push(eq(relations.fieldName, fieldName))
    }
    if (tenantId) {
      conditions.push(eq(relations.tenantId, tenantId))
    }
    return db
      .select()
      .from(relations)
      .where(and(...conditions))
      .orderBy(relations.sortOrder)
      .limit(100)
  },

  /** Find all relations where source entry is in the given list of IDs, optionally filtered by field. */
  async findBySourceEntries(
    db: Database,
    sourceEntryIds: string[],
    fieldNames?: string[],
    tenantId?: string
  ): Promise<RelationRow[]> {
    if (sourceEntryIds.length === 0) return []
    const cappedIds = [...new Set(sourceEntryIds)].slice(0, 100)
    if (cappedIds.length === 0) return []
    const conditions = [inArray(relations.sourceEntryId, cappedIds)]
    if (fieldNames && fieldNames.length > 0) {
      conditions.push(inArray(relations.fieldName, fieldNames))
    }
    if (tenantId) {
      conditions.push(eq(relations.tenantId, tenantId))
    }
    return db
      .select()
      .from(relations)
      .where(and(...conditions))
      .orderBy(relations.sortOrder)
      .limit(100)
  },

  /** Find all relations where the given entry is the target (reverse lookup). */
  async findByTargetEntry(
    db: Database,
    targetEntryId: string,
    tenantId?: string
  ): Promise<RelationRow[]> {
    const conditions = [eq(relations.targetEntryId, targetEntryId)]
    if (tenantId) {
      conditions.push(eq(relations.tenantId, tenantId))
    }
    return db.select().from(relations).where(and(...conditions)).limit(100)
  },

  /** Find relations for a specific source entry and field. */
  async findBySourceEntryAndField(
    db: Database,
    sourceEntryId: string,
    fieldName: string,
    tenantId?: string
  ): Promise<RelationRow[]> {
    const conditions = [
      eq(relations.sourceEntryId, sourceEntryId),
      eq(relations.fieldName, fieldName),
    ]
    if (tenantId) {
      conditions.push(eq(relations.tenantId, tenantId))
    }
    return db
      .select()
      .from(relations)
      .where(and(...conditions))
      .orderBy(relations.sortOrder)
      .limit(100)
  },

  /** Count relations for a specific source entry and field (for cardinality checks). */
  async countBySourceEntryAndField(
    db: Database,
    sourceEntryId: string,
    fieldName: string,
    tenantId?: string
  ): Promise<number> {
    const conditions = [
      eq(relations.sourceEntryId, sourceEntryId),
      eq(relations.fieldName, fieldName),
    ]
    if (tenantId) {
      conditions.push(eq(relations.tenantId, tenantId))
    }
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(relations)
      .where(and(...conditions))
    return result[0]?.count ?? 0
  },
}
