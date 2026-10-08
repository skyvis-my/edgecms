import { and, eq, sql } from 'drizzle-orm'
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
  async unlink(db: Database, id: string): Promise<boolean> {
    const rows = await db
      .delete(relations)
      .where(eq(relations.id, id))
      .returning({ id: relations.id })
    return rows.length > 0
  },

  /** Delete a relation by source entry, target entry, and field name. */
  async unlinkByEntries(
    db: Database,
    sourceEntryId: string,
    targetEntryId: string,
    fieldName: string
  ): Promise<boolean> {
    const rows = await db
      .delete(relations)
      .where(
        and(
          eq(relations.sourceEntryId, sourceEntryId),
          eq(relations.targetEntryId, targetEntryId),
          eq(relations.fieldName, fieldName)
        )
      )
      .returning({ id: relations.id })
    return rows.length > 0
  },

  /** Find all relations where the given entry is the source, optionally filtered by field. */
  async findBySourceEntry(
    db: Database,
    sourceEntryId: string,
    fieldName?: string
  ): Promise<RelationRow[]> {
    const conditions = [eq(relations.sourceEntryId, sourceEntryId)]
    if (fieldName) {
      conditions.push(eq(relations.fieldName, fieldName))
    }
    return db
      .select()
      .from(relations)
      .where(and(...conditions))
      .orderBy(relations.sortOrder)
  },

  /** Find all relations where the given entry is the target (reverse lookup). */
  async findByTargetEntry(db: Database, targetEntryId: string): Promise<RelationRow[]> {
    return db.select().from(relations).where(eq(relations.targetEntryId, targetEntryId))
  },

  /** Find relations for a specific source entry and field. */
  async findBySourceEntryAndField(
    db: Database,
    sourceEntryId: string,
    fieldName: string
  ): Promise<RelationRow[]> {
    return db
      .select()
      .from(relations)
      .where(and(eq(relations.sourceEntryId, sourceEntryId), eq(relations.fieldName, fieldName)))
      .orderBy(relations.sortOrder)
  },

  /** Count relations for a specific source entry and field (for cardinality checks). */
  async countBySourceEntryAndField(
    db: Database,
    sourceEntryId: string,
    fieldName: string
  ): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(relations)
      .where(and(eq(relations.sourceEntryId, sourceEntryId), eq(relations.fieldName, fieldName)))
    return result[0]?.count ?? 0
  },
}
