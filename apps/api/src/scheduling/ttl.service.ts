import { and, eq, gt, or, sql } from 'drizzle-orm'
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
export async function computeDynamicTTL(
  db: Database,
  collectionId: string,
  defaultTTL: number
): Promise<number> {
  const now = new Date().toISOString()

  // Query for entries with pending transitions.
  // We only care about future transitions (publish_at > now or unpublish_at > now)
  const scheduledEntries = await db
    .select({
      publishAt: entries.publishAt,
      unpublishAt: entries.unpublishAt,
    })
    .from(entries)
    .where(
      and(
        eq(entries.collectionId, collectionId),
        or(
          // Either publish_at exists and is in the future
          and(sql`${entries.publishAt} IS NOT NULL`, gt(entries.publishAt, now)),
          // Or unpublish_at exists and is in the future
          and(sql`${entries.unpublishAt} IS NOT NULL`, gt(entries.unpublishAt, now))
        )
      )
    )

  // Find the nearest transition timestamp
  let nearestTransition: string | null = null

  for (const entry of scheduledEntries) {
    // Check publish_at if it exists and is in the future
    if (entry.publishAt && entry.publishAt > now) {
      if (!nearestTransition || entry.publishAt < nearestTransition) {
        nearestTransition = entry.publishAt
      }
    }

    // Check unpublish_at if it exists and is in the future
    if (entry.unpublishAt && entry.unpublishAt > now) {
      if (!nearestTransition || entry.unpublishAt < nearestTransition) {
        nearestTransition = entry.unpublishAt
      }
    }
  }

  // If no pending transitions, return default TTL (capped at max)
  if (!nearestTransition) {
    return Math.min(defaultTTL, 3600)
  }

  // Compute seconds until transition
  const transitionTime = new Date(nearestTransition).getTime()
  const nowTime = Date.now()
  const secondsUntilTransition = Math.floor((transitionTime - nowTime) / 1000)

  // Compute TTL: min(defaultTTL, seconds_until_transition), capped between min and max
  const computedTTL = Math.min(defaultTTL, secondsUntilTransition)
  const boundedTTL = Math.max(60, Math.min(computedTTL, 3600))

  return boundedTTL
}
