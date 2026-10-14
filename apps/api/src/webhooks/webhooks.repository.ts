import { and, count, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { webhookDeliveries, webhooks } from '@/database/schema/webhooks.schema'

/** Row type inferred from the webhooks table. */
export type WebhookRow = typeof webhooks.$inferSelect

/** Insert type inferred from the webhooks table. */
export type WebhookInsert = typeof webhooks.$inferInsert

/** Row type inferred from the webhook_deliveries table. */
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect

/** Insert type inferred from the webhook_deliveries table. */
export type WebhookDeliveryInsert = typeof webhookDeliveries.$inferInsert

/** Summary of webhook counts and latest delivery status breakdown. */
export type WebhookStatusSummary = {
  total: number
  enabled: number
  failed: number
  pending: number
  delivered: number
}

function resolveTenantScope(tenantId?: string): string {
  return tenantId ?? 'global'
}

/**
 * Data access layer for the webhooks and webhook_deliveries tables.
 *
 * Every method receives a Drizzle DB instance as its first argument
 * (dependency injection) so callers can pass in the request-scoped
 * database connection created from the D1 binding.
 */
export const webhooksRepository = {
  /** List all webhooks ordered by creation date (newest first). */
  async findAll(db: Database, tenantId?: string, options: { limit?: number } = {}): Promise<WebhookRow[]> {
    const tenantScope = resolveTenantScope(tenantId)
    const limit = Math.min(100, Math.max(1, options.limit ?? 100))
    return db
      .select()
      .from(webhooks)
      .where(eq(webhooks.tenantId, tenantScope))
      .orderBy(desc(webhooks.createdAt))
      .limit(limit)
      .all()
  },

  /** Count webhooks, optionally scoped to a tenant (dashboard composite). */
  async countByTenant(db: Database, tenantId?: string): Promise<number> {
    if (typeof (db as unknown as { select?: unknown }).select !== 'function') return 0
    const base = db.select({ value: count() }).from(webhooks) as unknown as {
      where?: (cond: unknown) => unknown
      all?: () => Promise<Array<{ value: number }>>
    } & PromiseLike<Array<{ value: number }>>
    let rows: Array<{ value: number }>
    if (tenantId && typeof base.where === 'function') {
      const scoped = base.where(eq(webhooks.tenantId, resolveTenantScope(tenantId))) as unknown as {
        all?: () => Promise<Array<{ value: number }>>
      } & PromiseLike<Array<{ value: number }>>
      rows = typeof scoped.all === 'function' ? await scoped.all() : await scoped
    } else if (typeof base.all === 'function') {
      rows = await base.all()
    } else {
      rows = await base
    }
    const value = rows[0]?.value
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  },

  /**
   * Summarize webhook counts and latest delivery status breakdown, optionally
   * scoped to a tenant (dashboard composite).
   */
  async summarizeByTenant(db: Database, tenantId?: string): Promise<WebhookStatusSummary> {
    if (typeof (db as unknown as { select?: unknown }).select !== 'function') {
      return { total: 0, enabled: 0, failed: 0, pending: 0, delivered: 0 }
    }
    const lastStatusExpr = sql<string | null>`(SELECT ${webhookDeliveries.status} FROM ${webhookDeliveries} WHERE ${webhookDeliveries.webhookId} = ${webhooks.id} ORDER BY ${webhookDeliveries.createdAt} DESC LIMIT 1)`
    const base = db
      .select({
        total: count(),
        enabled: sql<number>`coalesce(sum(CASE WHEN ${webhooks.enabled} = 1 THEN 1 ELSE 0 END), 0)`,
        failed: sql<number>`coalesce(sum(CASE WHEN ${lastStatusExpr} = 'failed' THEN 1 ELSE 0 END), 0)`,
        pending: sql<number>`coalesce(sum(CASE WHEN ${lastStatusExpr} = 'pending' THEN 1 ELSE 0 END), 0)`,
        delivered: sql<number>`coalesce(sum(CASE WHEN ${lastStatusExpr} = 'delivered' THEN 1 ELSE 0 END), 0)`,
      })
      .from(webhooks) as unknown as {
      where?: (cond: unknown) => unknown
      all?: () => Promise<Array<Partial<WebhookStatusSummary> & { value?: number }>>
    } & PromiseLike<Array<Partial<WebhookStatusSummary> & { value?: number }>>

    let rows: Array<Partial<WebhookStatusSummary> & { value?: number }>
    if (tenantId && typeof base.where === 'function') {
      const scoped = base.where(eq(webhooks.tenantId, resolveTenantScope(tenantId))) as unknown as {
        all?: () => Promise<Array<Partial<WebhookStatusSummary> & { value?: number }>>
      } & PromiseLike<Array<Partial<WebhookStatusSummary> & { value?: number }>>
      rows = typeof scoped.all === 'function' ? await scoped.all() : await scoped
    } else if (typeof base.all === 'function') {
      rows = await base.all()
    } else {
      rows = await base
    }
    const row = rows[0]
    const total = Number(row?.total ?? row?.value ?? 0)
    return {
      total: Number.isFinite(total) ? total : 0,
      enabled: Number(row?.enabled ?? 0) || 0,
      failed: Number(row?.failed ?? 0) || 0,
      pending: Number(row?.pending ?? 0) || 0,
      delivered: Number(row?.delivered ?? 0) || 0,
    }
  },

  /** Find a single webhook by its primary key. */
  async findById(db: Database, id: string, tenantId?: string): Promise<WebhookRow | undefined> {
    const tenantScope = resolveTenantScope(tenantId)
    const rows = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantScope)))
      .limit(1)
      .all()
    return rows[0]
  },

  /** Insert a new webhook row. */
  async create(db: Database, data: WebhookInsert): Promise<WebhookRow> {
    const rows = await db.insert(webhooks).values(data).returning()
    // oxlint-disable-next-line lint/style/noNonNullAssertion: Drizzle insert().returning() always returns at least one row
    return rows[0]!
  },

  /** Update an existing webhook by ID. Returns the updated row or undefined if not found. */
  async update(
    db: Database,
    id: string,
    data: Partial<Omit<WebhookInsert, 'id'>>,
    tenantId?: string
  ): Promise<WebhookRow | undefined> {
    const tenantScope = resolveTenantScope(tenantId)
    const rows = await db
      .update(webhooks)
      .set(data)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantScope)))
      .returning()
    return rows[0]
  },

  /** Delete a webhook by ID. Returns true if a row was deleted. */
  async deleteById(db: Database, id: string, tenantId?: string): Promise<boolean> {
    const tenantScope = resolveTenantScope(tenantId)
    const rows = await db
      .delete(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.tenantId, tenantScope)))
      .returning({ id: webhooks.id })
    return rows.length > 0
  },

  /**
   * Find delivery logs for a webhook with pagination.
   * Returns deliveries ordered by creation date (newest first).
   */
  async findDeliveries(
    db: Database,
    webhookId: string,
    options?: { limit?: number; offset?: number; tenantId?: string }
  ): Promise<WebhookDeliveryRow[]> {
    const limit = Math.min(100, Math.max(1, options?.limit ?? 50))
    const offset = Math.max(0, options?.offset ?? 0)

    // Tenant scoping: deliveries join webhooks to enforce tenant ownership when provided.
    if (options?.tenantId) {
      const tenantScope = resolveTenantScope(options.tenantId)
      const rows = await db
        .select({ delivery: webhookDeliveries })
        .from(webhookDeliveries)
        .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
        .where(and(eq(webhookDeliveries.webhookId, webhookId), eq(webhooks.tenantId, tenantScope)))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(limit)
        .offset(offset)
        .all()
      return rows.map((r) => r.delivery)
    }
    return db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit)
      .offset(offset)
      .all()
  },

  /** Insert a new webhook delivery record. */
  async createDelivery(db: Database, data: WebhookDeliveryInsert): Promise<WebhookDeliveryRow> {
    const rows = await db.insert(webhookDeliveries).values(data).returning()
    // oxlint-disable-next-line lint/style/noNonNullAssertion: Drizzle insert().returning() always returns at least one row
    return rows[0]!
  },

  /** Update an existing delivery record by ID. Returns the updated row or undefined if not found. */
  async updateDelivery(
    db: Database,
    id: string,
    data: Partial<Omit<WebhookDeliveryInsert, 'id'>>,
    webhookId?: string
  ): Promise<WebhookDeliveryRow | undefined> {
    // Optional webhook scoping: only transition the delivery when it belongs to the webhook.
    const conds = [eq(webhookDeliveries.id, id)]
    if (webhookId) conds.push(eq(webhookDeliveries.webhookId, webhookId))
    const rows = await db
      .update(webhookDeliveries)
      .set(data)
      .where(and(...conds))
      .returning()
    return rows[0]
  },
}
