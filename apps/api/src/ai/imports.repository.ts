import { and, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import {
  aiImportBatches,
  aiImportSources,
  aiSuggestionSets,
  aiSuggestions,
  aiToolInvocations,
} from '@/database/schema'

export type AiImportBatch = typeof aiImportBatches.$inferSelect
export type AiImportSource = typeof aiImportSources.$inferSelect
export type AiSuggestionSet = typeof aiSuggestionSets.$inferSelect
export type AiSuggestion = typeof aiSuggestions.$inferSelect
export type AiToolInvocation = typeof aiToolInvocations.$inferSelect

function tenantScope(tenantId?: string): string {
  return tenantId ?? 'global'
}

export const aiImportsRepository = {
  async createBatch(
    db: Database,
    data: Omit<typeof aiImportBatches.$inferInsert, 'tenantId'> & { tenantId?: string }
  ): Promise<AiImportBatch> {
    const rows = await db
      .insert(aiImportBatches)
      .values({ ...data, tenantId: tenantScope(data.tenantId) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('Failed to create AI import batch')
    return row
  },

  async findBatch(db: Database, id: string, tenantId?: string): Promise<AiImportBatch | undefined> {
    const rows = await db
      .select()
      .from(aiImportBatches)
      .where(and(eq(aiImportBatches.id, id), eq(aiImportBatches.tenantId, tenantScope(tenantId))))
      .limit(1)
    return rows[0]
  },

  async updateBatch(
    db: Database,
    id: string,
    tenantId: string | undefined,
    data: Partial<typeof aiImportBatches.$inferInsert>
  ): Promise<AiImportBatch | undefined> {
    const rows = await db
      .update(aiImportBatches)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(and(eq(aiImportBatches.id, id), eq(aiImportBatches.tenantId, tenantScope(tenantId))))
      .returning()
    return rows[0]
  },

  async incrementSourceCount(db: Database, batchId: string, tenantId?: string): Promise<void> {
    await db
      .update(aiImportBatches)
      .set({
        sourceCount: sql`${aiImportBatches.sourceCount} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(aiImportBatches.id, batchId), eq(aiImportBatches.tenantId, tenantScope(tenantId))))
  },

  async createSource(
    db: Database,
    data: Omit<typeof aiImportSources.$inferInsert, 'tenantId'> & { tenantId?: string }
  ): Promise<AiImportSource> {
    const rows = await db
      .insert(aiImportSources)
      .values({ ...data, tenantId: tenantScope(data.tenantId) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('Failed to create AI import source')
    await this.incrementSourceCount(db, data.batchId, data.tenantId)
    return row
  },

  async listSources(db: Database, batchId: string, tenantId?: string): Promise<AiImportSource[]> {
    return db
      .select()
      .from(aiImportSources)
      .where(and(eq(aiImportSources.batchId, batchId), eq(aiImportSources.tenantId, tenantScope(tenantId))))
      .orderBy(desc(aiImportSources.createdAt))
  },

  async createSuggestionSet(
    db: Database,
    data: Omit<typeof aiSuggestionSets.$inferInsert, 'tenantId'> & { tenantId?: string }
  ): Promise<AiSuggestionSet> {
    const rows = await db
      .insert(aiSuggestionSets)
      .values({ ...data, tenantId: tenantScope(data.tenantId) })
      .returning()
    const row = rows[0]
    if (!row) throw new Error('Failed to create AI suggestion set')
    return row
  },

  async updateSuggestionSet(
    db: Database,
    id: string,
    tenantId: string | undefined,
    data: Partial<typeof aiSuggestionSets.$inferInsert>
  ): Promise<AiSuggestionSet | undefined> {
    const rows = await db
      .update(aiSuggestionSets)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(and(eq(aiSuggestionSets.id, id), eq(aiSuggestionSets.tenantId, tenantScope(tenantId))))
      .returning()
    return rows[0]
  },

  async latestSuggestionSet(
    db: Database,
    batchId: string,
    tenantId?: string
  ): Promise<AiSuggestionSet | undefined> {
    const rows = await db
      .select()
      .from(aiSuggestionSets)
      .where(and(eq(aiSuggestionSets.batchId, batchId), eq(aiSuggestionSets.tenantId, tenantScope(tenantId))))
      .orderBy(desc(aiSuggestionSets.createdAt))
      .limit(1)
    return rows[0]
  },

  async findSuggestionSet(
    db: Database,
    id: string,
    tenantId?: string
  ): Promise<AiSuggestionSet | undefined> {
    const rows = await db
      .select()
      .from(aiSuggestionSets)
      .where(and(eq(aiSuggestionSets.id, id), eq(aiSuggestionSets.tenantId, tenantScope(tenantId))))
      .limit(1)
    return rows[0]
  },

  async createSuggestions(
    db: Database,
    rows: (Omit<typeof aiSuggestions.$inferInsert, 'tenantId'> & { tenantId?: string })[]
  ): Promise<AiSuggestion[]> {
    if (rows.length === 0) return []
    return db
      .insert(aiSuggestions)
      .values(rows.map((row) => ({ ...row, tenantId: tenantScope(row.tenantId) })))
      .returning()
  },

  async listSuggestions(
    db: Database,
    suggestionSetId: string,
    tenantId: string | undefined,
    input: { page?: number; perPage?: number; status?: string } = {}
  ): Promise<{ rows: AiSuggestion[]; total: number }> {
    const page = input.page ?? 1
    const perPage = Math.min(input.perPage ?? 20, 100)
    const filters = [
      eq(aiSuggestions.suggestionSetId, suggestionSetId),
      eq(aiSuggestions.tenantId, tenantScope(tenantId)),
    ]
    if (input.status) filters.push(eq(aiSuggestions.status, input.status as AiSuggestion['status']))
    const where = and(...filters)
    const totalRows = await db.select({ count: sql<number>`count(*)` }).from(aiSuggestions).where(where)
    const rows = await db
      .select()
      .from(aiSuggestions)
      .where(where)
      .orderBy(desc(aiSuggestions.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage)
    return { rows, total: totalRows[0]?.count ?? 0 }
  },

  async findSuggestion(db: Database, id: string, tenantId?: string): Promise<AiSuggestion | undefined> {
    const rows = await db
      .select()
      .from(aiSuggestions)
      .where(and(eq(aiSuggestions.id, id), eq(aiSuggestions.tenantId, tenantScope(tenantId))))
      .limit(1)
    return rows[0]
  },

  async updateSuggestion(
    db: Database,
    id: string,
    tenantId: string | undefined,
    data: Partial<typeof aiSuggestions.$inferInsert>
  ): Promise<AiSuggestion | undefined> {
    const rows = await db
      .update(aiSuggestions)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(and(eq(aiSuggestions.id, id), eq(aiSuggestions.tenantId, tenantScope(tenantId))))
      .returning()
    return rows[0]
  },

  async insertToolInvocation(
    db: Database,
    data: Omit<typeof aiToolInvocations.$inferInsert, 'tenantId'> & { tenantId?: string }
  ): Promise<void> {
    await db.insert(aiToolInvocations).values({ ...data, tenantId: tenantScope(data.tenantId) })
  },
}
