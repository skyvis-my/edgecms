import { drizzle } from 'drizzle-orm/d1'
import type { Database } from '@/database/db'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { relaySideEffectIntents } from './side-effect-intents'

/**
 * CMD-06: cron entry point. Relays pending side-effect intents (KV snapshot
 * invalidation, CDN purge, frontend revalidation, RAG, FTS) older than 60 s,
 * so work left by a crashed request completes even when no later command runs
 * the in-request relay. Never throws.
 */
export async function runScheduledSideEffectSweep(env: Env | undefined, limit = 100) {
  if (!env?.DB) return null
  try {
    const result = await relaySideEffectIntents(
      { db: drizzle(env.DB) as unknown as Database, env, kv: env.CACHE },
      { limit, staleOnlyMs: 60_000 }
    )
    logger.info('side_effect_intent_sweep_completed', {
      claimed: result.claimed,
      done: result.done.length,
      failed: result.failed.length,
    })
    return result
  } catch (err) {
    logger.error('side_effect_intent_sweep_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
