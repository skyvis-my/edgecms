import { and, eq, gt, sql } from 'drizzle-orm'
import type { Database } from '@/database/db'
import { entries } from '@/database/schema/entries.schema'

/**
 * TTL Service — Computes dynamic cache TTL based on upcoming publish/unpublish transitions.
 *
 * This service queries the entries table for the nearest future transition (publish_at or unpublish_at)
 * for a given collection, then computes a cache TTL that ensures the cache expires before the transition.
 *
 * Benefits:
 * - Cache stays fresh during stable periods (no upcoming transitions)
 * - Cache automatically expires just before content changes (scheduled publish/unpublish)
 * - Prevents stale content from being served after scheduled transitions
 *
 * TTL bounds:
 * - Minimum: 60 seconds (avoid cache thrashing)
 * - Maximum: 3600 seconds (1 hour)
 */

/**
 * Compute dynamic cache TTL based on the nearest upcoming transition for a collection.
 *
 * Algorithm:
 * 1. Query entries table for entries in the given collection
 * 2. Find the nearest future publish_at or unpublish_at timestamp
 * 3. Calculate seconds until that transition
 * 4. Return min(defaultTTL, seconds_until_transition), capped between 60s and 3600s
 * 5. If no pending transitions, return defaultTTL (capped at 3600s)
 *
 * @param db - Drizzle database instance
 * @param collectionId - Collection ID to check for pending transitions
 * @param defaultTTL - Default TTL in seconds (used when no transitions are pending)
 * @returns Computed TTL in seconds, bounded between 60 and 3600
 */
/**
 * Get seconds until the nearest upcoming scheduled transition for a collection.
 * Returns null if no upcoming transitions exist.
 */
export async function getNearestTransitionSeconds(
  db: Database,
  collectionId: string
): Promise<number | null> {
  const now = new Date().toISOString()

  // Dual-compatible: real D1 supports .limit(1) on the chain (fast min()
  // aggregates); legacy mock drivers only support select().from().where()
  // resolving to {publishAt,unpublishAt} rows, so fall back to a JS min loop.
  const probe = db
    .select({ nearest: sql<string | null>`min(${entries.publishAt})` })
    .from(entries)
    .where(
      and(
        eq(entries.collectionId, collectionId),
        sql`${entries.publishAt} IS NOT NULL`,
        gt(entries.publishAt, now)
      )
    ) as unknown as { limit?: unknown }
  if (typeof probe.limit === 'function') {
    // Single aggregate query returning both minima (1 round-trip, not 2).
    const rows = await (
      db
        .select({
          nearestPublish: sql<string | null>`min(${entries.publishAt})`,
          nearestUnpublish: sql<string | null>`min(${entries.unpublishAt})`,
        })
        .from(entries)
        .where(
          and(
            eq(entries.collectionId, collectionId),
            sql`(${entries.publishAt} IS NOT NULL AND ${entries.publishAt} > ${now}) OR (${entries.unpublishAt} IS NOT NULL AND ${entries.unpublishAt} > ${now})`
          )
        ) as unknown as { limit: (n: number) => Promise<Array<{ nearestPublish: string | null; nearestUnpublish: string | null }>> }
    ).limit(1)

    const candidates = [rows[0]?.nearestPublish, rows[0]?.nearestUnpublish].filter(
      (v): v is string => typeof v === 'string' && v.length > 0
    )
    // Nearest future timestamp in JS (ISO strings sort lexicographically).
    const future = candidates.filter((v) => v > now)
    if (future.length === 0) return null
    const nearestTransition = future.sort()[0] as string

    const transitionTime = new Date(nearestTransition).getTime()
    return Math.floor((transitionTime - Date.now()) / 1000)
  }

  // Legacy fallback for mock drivers without .limit: single select of both
  // columns, JS min over future timestamps.
  const rows = (await db
    .select({ publishAt: entries.publishAt, unpublishAt: entries.unpublishAt })
    .from(entries)
    .where(eq(entries.collectionId, collectionId))) as unknown as Array<{
    publishAt: string | null
    unpublishAt: string | null
  }>
  const nowMs = Date.now()
  let nearestMs: number | null = null
  for (const row of rows) {
    for (const value of [row.publishAt, row.unpublishAt]) {
      if (typeof value !== 'string' || value.length === 0) continue
      const ms = new Date(value).getTime()
      if (Number.isNaN(ms) || ms <= nowMs) continue
      if (nearestMs === null || ms < nearestMs) nearestMs = ms
    }
  }
  if (nearestMs === null) return null
  return Math.floor((nearestMs - nowMs) / 1000)
}

/**
 * Bounds a dynamic TTL given seconds until transition and target default TTL.
 */
export function computeBoundedTTL(
  secondsUntilTransition: number | null,
  defaultTTL: number,
  minTTL = 60,
  maxTTL = 3600
): number {
  if (secondsUntilTransition === null) {
    return Math.min(defaultTTL, maxTTL)
  }
  const computedTTL = Math.min(defaultTTL, secondsUntilTransition)
  return Math.max(minTTL, Math.min(computedTTL, maxTTL))
}

export async function computeDynamicTTL(
  db: Database,
  collectionId: string,
  defaultTTL: number
): Promise<number> {
  const seconds = await getNearestTransitionSeconds(db, collectionId)
  return computeBoundedTTL(seconds, defaultTTL)
}

