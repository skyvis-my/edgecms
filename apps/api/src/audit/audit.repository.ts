import { and, asc, desc, eq, gt, lt, lte } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { auditEvents, type AuditEventRow } from '@/database/schema'

export const auditRepository = {
  async findHead(
    db: Database,
    scope: string
  ): Promise<{ seq: number; hash: string; occurredAt: string } | null> {
    const rows = await db
      .select({ seq: auditEvents.seq, hash: auditEvents.hash, occurredAt: auditEvents.occurredAt })
      .from(auditEvents)
      .where(eq(auditEvents.scope, scope))
      .orderBy(desc(auditEvents.seq))
      .limit(1)
    return rows[0] ?? null
  },

  async insert(db: Database, row: AuditEventRow): Promise<void> {
    await db.insert(auditEvents).values(row)
  },

  async listPage(
    db: Database,
    scope: string,
    afterSeq: number,
    limit: number
  ): Promise<AuditEventRow[]> {
    return db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.scope, scope), gt(auditEvents.seq, afterSeq)))
      .orderBy(asc(auditEvents.seq))
      .limit(limit)
  },

  /** Newest event strictly older than `cutoff` (ISO timestamp). */
  async findLatestBefore(
    db: Database,
    scope: string,
    cutoff: string
  ): Promise<{ seq: number; hash: string } | null> {
    const rows = await db
      .select({ seq: auditEvents.seq, hash: auditEvents.hash })
      .from(auditEvents)
      .where(and(eq(auditEvents.scope, scope), lt(auditEvents.occurredAt, cutoff)))
      .orderBy(desc(auditEvents.seq))
      .limit(1)
    return rows[0] ?? null
  },

  async deleteThroughSeq(db: Database, scope: string, seq: number): Promise<void> {
    await db
      .delete(auditEvents)
      .where(and(eq(auditEvents.scope, scope), lte(auditEvents.seq, seq)))
  },
}
