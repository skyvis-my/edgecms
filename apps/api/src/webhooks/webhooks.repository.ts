import { desc, eq } from 'drizzle-orm'
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
  async findAll(db: Database, tenantId?: string): Promise<WebhookRow[]> {
    const tenantScope = resolveTenantScope(tenantId)
    return db
      .select()
      .from(webhooks)
      .where(eq(webhooks.tenantId, tenantScope))
      .orderBy(desc(webhooks.createdAt))
      .all()
  },

  /** Find a single webhook by its primary key. */
  async findById(db: Database, id: string, tenantId?: string): Promise<WebhookRow | undefined> {
    const tenantScope = resolveTenantScope(tenantId)
    const rows = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, id))
      .limit(1)
      .all()
    const row = rows[0]
    if (!row || row.tenantId !== tenantScope) {
      return undefined
    }
    return row
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
    const existing = await this.findById(db, id, tenantId)
    if (!existing) {
      return undefined
    }
    const rows = await db.update(webhooks).set(data).where(eq(webhooks.id, id)).returning()
    return rows[0]
  },

  /** Delete a webhook by ID. Returns true if a row was deleted. */
  async deleteById(db: Database, id: string, tenantId?: string): Promise<boolean> {
    const existing = await this.findById(db, id, tenantId)
    if (!existing) {
      return false
    }
    const rows = await db.delete(webhooks).where(eq(webhooks.id, id)).returning({ id: webhooks.id })
    return rows.length > 0
  },

  /**
   * Find delivery logs for a webhook with pagination.
   * Returns deliveries ordered by creation date (newest first).
   */
  async findDeliveries(
    db: Database,
    webhookId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<WebhookDeliveryRow[]> {
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

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
    data: Partial<Omit<WebhookDeliveryInsert, 'id'>>
  ): Promise<WebhookDeliveryRow | undefined> {
    const rows = await db
      .update(webhookDeliveries)
      .set(data)
      .where(eq(webhookDeliveries.id, id))
      .returning()
    return rows[0]
  },
}
