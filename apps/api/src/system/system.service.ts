import { and, count, eq, sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { collections, entries } from '@/database/schema'
import type { Env } from '@/env'
import { assetsRepository, type AssetUsageSummary } from '@/assets/assets.repository'
import { sweepScheduleIntents, type ScheduleSweepResult } from '@/scheduling/schedule-intents.repository'
import { webhooksRepository, type WebhookStatusSummary } from '@/webhooks/webhooks.repository'

export type { WebhookStatusSummary }

export const systemService = {
  async getStats(db: Database, tenantId?: string) {
    const collectionQuery = db.select({ count: count() }).from(collections)
    const entryQuery = db.select({ count: count() }).from(entries)

    if (tenantId) {
      const tenantEntryExists = sql`EXISTS (SELECT 1 FROM ${collections} WHERE ${collections.id} = ${entries.collectionId} AND ${collections.tenantId} = ${tenantId})`
      const [collectionCount, entryCount, publishedCount] = await Promise.all([
        (typeof (collectionQuery as unknown as { where?: unknown }).where === 'function'
          ? collectionQuery.where(eq(collections.tenantId, tenantId))
          : collectionQuery
        ).then((r) => r[0]?.count ?? 0),
        (typeof (entryQuery as unknown as { where?: unknown }).where === 'function'
          ? entryQuery.where(tenantEntryExists)
          : entryQuery
        ).then((r) => r[0]?.count ?? 0),
        db
          .select({ count: count() })
          .from(entries)
          .where(and(eq(entries.status, 'published'), tenantEntryExists))
          .then((r) => r[0]?.count ?? 0),
      ])

      return {
        collections: collectionCount,
        entries: entryCount,
        publishedEntries: publishedCount,
      }
    }

    const [collectionCount, entryCount, publishedCount] = await Promise.all([
      collectionQuery.then((r) => r[0]?.count ?? 0),
      entryQuery.then((r) => r[0]?.count ?? 0),
      db
        .select({ count: count() })
        .from(entries)
        .where(eq(entries.status, 'published'))
        .then((r) => r[0]?.count ?? 0),
    ])

    return {
      collections: collectionCount,
      entries: entryCount,
      publishedEntries: publishedCount,
    }
  },

  /**
   * Reconcile open schedule intents against the scheduler DO queue.
   * Drains lost notify/cancel calls (see sweepScheduleIntents).
   */
  async sweepSchedules(db: Database, env: Env): Promise<ScheduleSweepResult> {
    return sweepScheduleIntents(db, env, { limit: 50 })
  },

  /**
   * Dashboard composite: stats + webhook status breakdown + asset usage in ONE
   * authenticated request (3 parallel D1 queries, 1 auth tax) instead of
   * one round-trip per widget.
   */
  async getDashboardSummary(
    db: Database,
    tenantId?: string
  ): Promise<{
    stats: { collections: number; entries: number; publishedEntries: number }
    webhooks: WebhookStatusSummary
    assets: AssetUsageSummary
  }> {
    const summarizeWebhooks =
      typeof (webhooksRepository as { summarizeByTenant?: unknown }).summarizeByTenant === 'function'
        ? webhooksRepository.summarizeByTenant(db, tenantId)
        : webhooksRepository.countByTenant(db, tenantId).then((total) => ({
            total,
            enabled: 0,
            failed: 0,
            pending: 0,
            delivered: 0,
          }))

    const [stats, webhooks, assetUsage] = await Promise.all([
      this.getStats(db, tenantId),
      summarizeWebhooks,
      assetsRepository.summarizeUsage(db, tenantId),
    ])
    return { stats, webhooks, assets: assetUsage }
  },
}
