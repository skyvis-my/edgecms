import { sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { extractTextFromContent } from '@/ai/rag.service'
import { logger } from '@/observability/logger'

export interface FtsSearchResult {
  entryId: string
  collectionId: string
  title: string
  snippet: string
  score: number
}

/**
 * Standalone SQLite FTS5 Virtual Table & Search Service for EdgeCMS.
 *
 * Avoids external content table crash (external FTS5 on `entries` fails because
 * dynamic fields are stored inside JSON blobs).
 */
export const ftsService = {
  /**
   * Initializes the standalone FTS5 virtual table if it does not already exist.
   */
  async ensureFtsTable(db: Database): Promise<boolean> {
    try {
      await db.run(sql`
        CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
          entry_id UNINDEXED,
          tenant_id UNINDEXED,
          collection_id UNINDEXED,
          locale UNINDEXED,
          title,
          body,
          tokenize='porter unicode61 remove_diacritics 2'
        );
      `)
      return true
    } catch (err) {
      // In-memory mocks or test environments may lack FTS5 extension
      logger.warn('fts5_init_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  },

  /**
   * Syncs a published entry into the FTS5 virtual table.
   */
  async syncPublishedEntry(
    db: Database,
    entry: {
      id: string
      tenantId?: string | null
      collectionId: string
      data?: unknown
      slug?: string | null
    },
    locale = 'en'
  ): Promise<boolean> {
    try {
      await this.ensureFtsTable(db)
      const tenantScope = entry.tenantId ?? 'global'
      const entryData = (entry.data ?? {}) as Record<string, unknown>
      const title = String(entryData.title || entryData.name || entry.slug || entry.id)
      const body = extractTextFromContent(entryData)

      // Remove existing row first
      await this.removeEntry(db, entry.id, tenantScope)

      // Insert new FTS document
      await db.run(sql`
        INSERT INTO entries_fts(entry_id, tenant_id, collection_id, locale, title, body)
        VALUES (${entry.id}, ${tenantScope}, ${entry.collectionId}, ${locale}, ${title}, ${body})
      `)
      return true
    } catch (err) {
      logger.warn('fts5_sync_failed', {
        entryId: entry.id,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  },

  /**
   * Removes an entry from the FTS5 virtual table upon unpublish or delete.
   */
  async removeEntry(db: Database, entryId: string, tenantId?: string): Promise<boolean> {
    try {
      const tenantScope = tenantId ?? 'global'
      await db.run(sql`
        DELETE FROM entries_fts WHERE entry_id = ${entryId} AND tenant_id = ${tenantScope}
      `)
      return true
    } catch {
      return false
    }
  },

  /**
   * Performs BM25 full-text search against the FTS5 table with tenant isolation.
   */
  async search(
    db: Database,
    query: string,
    tenantId?: string,
    limit = 20
  ): Promise<FtsSearchResult[]> {
    const cleanQuery = query.trim().replace(/['"*]/g, '')
    if (!cleanQuery) return []

    const tenantScope = tenantId ?? 'global'
    try {
      await this.ensureFtsTable(db)
      const matchQuery = `${cleanQuery}*`

      const rows = (await db.all(sql`
        SELECT
          entry_id,
          collection_id,
          title,
          snippet(entries_fts, 5, '<b>', '</b>', '...', 15) as snippet,
          bm25(entries_fts) as rank
        FROM entries_fts
        WHERE entries_fts MATCH ${matchQuery} AND tenant_id = ${tenantScope}
        ORDER BY rank
        LIMIT ${limit}
      `)) as unknown as Array<{
        entry_id: string
        collection_id: string
        title: string
        snippet: string
        rank: number
      }>

      return rows.map((r) => ({
        entryId: r.entry_id,
        collectionId: r.collection_id,
        title: r.title,
        snippet: r.snippet,
        score: Number((1 / (1 + Math.abs(r.rank))).toFixed(4)),
      }))
    } catch (err) {
      logger.warn('fts5_search_failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      return []
    }
  },
}
