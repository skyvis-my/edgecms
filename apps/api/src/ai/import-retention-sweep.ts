import { and, asc, eq, inArray, isNull, lte, notExists } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Database } from '@/database/db'
import {
  aiImportBatches,
  aiImportSources,
  aiSuggestionSets,
  aiSuggestions,
  aiToolInvocations,
} from '@/database/schema'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { AI_IMPORT_RETENTION_DAYS } from './imports.service'

const DAY_MS = 24 * 60 * 60 * 1000

export type AiImportCleanupResult = {
  sourcesPurged: number
  r2Deleted: number
  r2Skipped: number
  r2Failed: number
  batchesDeleted: number
}

export type AiImportCleanupOptions = {
  now?: Date
  /** Max expired sources purged per run. */
  sourceLimit?: number
  /** Max expired batches deleted per run. */
  batchLimit?: number
}

/** The only R2 prefix an import source of this tenant and batch may own. */
function ownedPrefix(tenantId: string, batchId: string): string {
  return `${tenantId}/ai-imports/${batchId}/`
}

/**
 * AI-08: bounded retention cleanup for AI import review records.
 *
 * 1. Sources past `expires_at`: delete their R2 object (only when the key sits
 *    under the row's own `<tenant>/ai-imports/<batch>/` prefix), clear stored
 *    text and media summaries, and stamp `purged_at` with an audit note. A
 *    failed R2 delete leaves the row unpurged so the next run retries it.
 * 2. Batches not updated for the retention window and with no unpurged
 *    source: delete the batch and its sources, suggestion sets, suggestions
 *    and tool invocations, every delete scoped to the batch's tenant.
 */
export async function purgeExpiredAiImports(
  db: Database,
  media: R2Bucket,
  options: AiImportCleanupOptions = {}
): Promise<AiImportCleanupResult> {
  const now = options.now ?? new Date()
  const nowIso = now.toISOString()
  const result: AiImportCleanupResult = {
    sourcesPurged: 0,
    r2Deleted: 0,
    r2Skipped: 0,
    r2Failed: 0,
    batchesDeleted: 0,
  }

  const expiredSources = await db
    .select({
      id: aiImportSources.id,
      batchId: aiImportSources.batchId,
      tenantId: aiImportSources.tenantId,
      r2ObjectKey: aiImportSources.r2ObjectKey,
    })
    .from(aiImportSources)
    .where(and(lte(aiImportSources.expiresAt, nowIso), isNull(aiImportSources.purgedAt)))
    .orderBy(asc(aiImportSources.expiresAt))
    .limit(options.sourceLimit ?? 100)
    .all()

  for (const source of expiredSources) {
    let r2: 'none' | 'deleted' | 'skipped_prefix_mismatch' = 'none'
    if (source.r2ObjectKey) {
      if (source.r2ObjectKey.startsWith(ownedPrefix(source.tenantId, source.batchId))) {
        try {
          await media.delete(source.r2ObjectKey)
          r2 = 'deleted'
          result.r2Deleted++
        } catch (err) {
          result.r2Failed++
          logger.warn('ai_import_cleanup_r2_delete_failed', {
            sourceId: source.id,
            tenantId: source.tenantId,
            error: err instanceof Error ? err.message : String(err),
          })
          continue
        }
      } else {
        r2 = 'skipped_prefix_mismatch'
        result.r2Skipped++
        logger.warn('ai_import_cleanup_r2_prefix_mismatch', {
          sourceId: source.id,
          tenantId: source.tenantId,
        })
      }
    }
    await db
      .update(aiImportSources)
      .set({
        purgedAt: nowIso,
        extractedText: null,
        mediaSummaryJson: null,
        purgeAuditJson: { r2, reason: 'retention_expired' },
      })
      .where(and(eq(aiImportSources.id, source.id), eq(aiImportSources.tenantId, source.tenantId)))
    result.sourcesPurged++
  }

  const batchCutoff = new Date(now.getTime() - AI_IMPORT_RETENTION_DAYS * DAY_MS).toISOString()
  const expiredBatches = await db
    .select({ id: aiImportBatches.id, tenantId: aiImportBatches.tenantId })
    .from(aiImportBatches)
    .where(
      and(
        lte(aiImportBatches.updatedAt, batchCutoff),
        notExists(
          db
            .select({ id: aiImportSources.id })
            .from(aiImportSources)
            .where(and(eq(aiImportSources.batchId, aiImportBatches.id), isNull(aiImportSources.purgedAt)))
        )
      )
    )
    .orderBy(asc(aiImportBatches.updatedAt))
    .limit(options.batchLimit ?? 50)
    .all()

  for (const batch of expiredBatches) {
    const scope = batch.tenantId
    const sets = await db
      .select({ id: aiSuggestionSets.id })
      .from(aiSuggestionSets)
      .where(and(eq(aiSuggestionSets.batchId, batch.id), eq(aiSuggestionSets.tenantId, scope)))
      .all()
    const setIds = sets.map((set) => set.id)
    if (setIds.length > 0) {
      await db
        .delete(aiSuggestions)
        .where(and(inArray(aiSuggestions.suggestionSetId, setIds), eq(aiSuggestions.tenantId, scope)))
    }
    await db
      .delete(aiSuggestionSets)
      .where(and(eq(aiSuggestionSets.batchId, batch.id), eq(aiSuggestionSets.tenantId, scope)))
    await db
      .delete(aiToolInvocations)
      .where(and(eq(aiToolInvocations.batchId, batch.id), eq(aiToolInvocations.tenantId, scope)))
    await db
      .delete(aiImportSources)
      .where(and(eq(aiImportSources.batchId, batch.id), eq(aiImportSources.tenantId, scope)))
    // Batch last: if a child delete fails, the batch still matches next run.
    await db
      .delete(aiImportBatches)
      .where(and(eq(aiImportBatches.id, batch.id), eq(aiImportBatches.tenantId, scope)))
    result.batchesDeleted++
  }

  return result
}

/** AI-08: cron entry point. Never throws, so other scheduled sweeps still run. */
export async function runScheduledAiImportCleanup(
  env: Env | undefined,
  options: AiImportCleanupOptions = {}
): Promise<AiImportCleanupResult | null> {
  if (!env?.DB || !env.MEDIA) return null
  try {
    const result = await purgeExpiredAiImports(
      drizzle(env.DB) as unknown as Database,
      env.MEDIA,
      options
    )
    logger.info('ai_import_cleanup_completed', result)
    return result
  } catch (err) {
    logger.error('ai_import_cleanup_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
