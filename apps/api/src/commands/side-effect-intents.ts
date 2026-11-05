import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import { cdnPurgeService } from '@/cache/cdn-purge.service'
import { invalidateByTags } from '@/cache/invalidation.service'
import { ragService } from '@/ai/rag.service'
import type { Database } from '@/database/db'
import { sideEffectIntents } from '@/database/schema/side-effects.schema'
import { entriesRepository } from '@/entries/entries.repository'
import type { Env } from '@/env'
import { logger } from '@/observability/logger'
import { ftsService } from '@/search/fts.service'

/**
 * CMD-06: durable post-commit side-effect intents.
 *
 * The command engine builds one intent per side effect of a successful
 * command and writes the rows in the SAME D1 batch as the processed command
 * (engine `recordCommand`). After the commit it runs them with
 * `runSideEffectIntents` and marks each row `done`. A crash after the commit,
 * or a failed call, leaves the row `pending`; `relaySideEffectIntents`
 * claims and retries it with backoff. Every side effect is idempotent
 * (version bump, tag purge, revalidation ping, vector upsert, FTS
 * delete+insert from the current entry state), so a retry after a lost
 * `done` mark is safe.
 *
 * `relaySideEffectIntents` is the entry point for a scheduled() sweeper.
 */

export type SideEffectKind =
  | 'kv_invalidate'
  | 'cdn_purge'
  | 'frontend_revalidate'
  | 'rag_index'
  | 'fts_sync'

export type SideEffectIntent = {
  id: string
  kind: SideEffectKind
  tenantScope: string
  commandId: string | null
  payload: Record<string, unknown>
  /** Attempts already made (0 for a fresh intent). */
  attempts: number
}

export type SideEffectDeps = {
  db: Database
  env?: Env
  /** Snapshot KV namespace. Defaults to `env.CACHE`. */
  kv?: KVNamespace
  fetchImpl?: typeof fetch
}

export type RevalidateTarget = {
  event: string
  tags: string[]
  paths: string[]
  entryId?: string
  collectionSlug?: string
}

/** After this many attempts a row is marked `failed` and no longer retried. */
export const SIDE_EFFECT_MAX_ATTEMPTS = 8
const BASE_BACKOFF_MS = 30_000
const MAX_BACKOFF_MS = 60 * 60_000
/** How long a relay claim holds a row before another relay may take it. */
const CLAIM_LEASE_MS = 5 * 60_000

const FTS_COMMANDS = new Set(['publishNow', 'unpublishNow', 'deleteEntry'])

/**
 * Build the intents for one successful command. Pure: no I/O.
 *
 * - `kv_invalidate` when a snapshot KV namespace is bound and tags exist.
 * - `cdn_purge` when tags exist and the Cloudflare purge API is configured.
 * - `frontend_revalidate` when FRONTEND_REVALIDATE_URL is set.
 * - `rag_index` on publishNow.
 * - `fts_sync` on publishNow, unpublishNow and deleteEntry.
 */
export function buildSideEffectIntents(input: {
  commandId: string
  commandType: string
  /** Row tenant scope ('global' or tenant ID) for offboarding and isolation. */
  tenantScope: string
  /** Tenant passed to tenant-scoped reads (the handler's ctx.tenantScope). */
  entityTenant?: string
  payload: Record<string, unknown>
  cacheTags: string[]
  revalidate?: RevalidateTarget
  env?: Env
  hasKv: boolean
}): SideEffectIntent[] {
  const intents: SideEffectIntent[] = []
  const add = (kind: SideEffectKind, payload: Record<string, unknown>) =>
    intents.push({
      id: crypto.randomUUID(),
      kind,
      tenantScope: input.tenantScope,
      commandId: input.commandId,
      payload,
      attempts: 0,
    })

  const tags = [...new Set(input.cacheTags)]
  if (tags.length > 0 && input.hasKv) add('kv_invalidate', { tags })
  if (tags.length > 0 && input.env?.CF_API_TOKEN && input.env?.CLOUDFLARE_ZONE_ID) {
    add('cdn_purge', { tags })
  }
  if (input.revalidate && input.env?.FRONTEND_REVALIDATE_URL) {
    add('frontend_revalidate', { ...input.revalidate })
  }

  const entryId = typeof input.payload.entryId === 'string' ? input.payload.entryId : undefined
  const tenant = input.entityTenant ? { tenantId: input.entityTenant } : {}
  if (entryId && input.commandType === 'publishNow') add('rag_index', { entryId, ...tenant })
  if (entryId && FTS_COMMANDS.has(input.commandType)) add('fts_sync', { entryId, ...tenant })

  return intents
}

/** Insert values for the engine's commit batch. */
export function sideEffectInsertValues(intent: SideEffectIntent, now = new Date().toISOString()) {
  return {
    id: intent.id,
    commandId: intent.commandId,
    tenantScope: intent.tenantScope,
    kind: intent.kind,
    payload: intent.payload,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null as string | null,
    lastError: null as string | null,
    createdAt: now,
    completedAt: null as string | null,
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

async function executeIntent(deps: SideEffectDeps, intent: SideEffectIntent): Promise<void> {
  const payload = intent.payload ?? {}
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : undefined
  const entryId = typeof payload.entryId === 'string' ? payload.entryId : undefined

  switch (intent.kind) {
    case 'kv_invalidate': {
      const kv = deps.kv ?? (deps.env?.CACHE as KVNamespace | undefined)
      if (!kv) throw new Error('snapshot KV namespace is not bound')
      await invalidateByTags(deps.db, kv, stringList(payload.tags))
      return
    }
    case 'cdn_purge': {
      const result = await cdnPurgeService.purgeCloudflareCacheTags(
        deps.env,
        stringList(payload.tags),
        deps.fetchImpl
      )
      if (!result.success) throw new Error(result.error ?? 'CDN purge failed')
      return
    }
    case 'frontend_revalidate': {
      const url = deps.env?.FRONTEND_REVALIDATE_URL
      // Revalidation was switched off after the intent was written: nothing to do.
      if (!url) return
      const result = await cdnPurgeService.dispatchFrontendRevalidation(
        url,
        {
          event: String(payload.event ?? ''),
          tags: stringList(payload.tags),
          paths: stringList(payload.paths),
          ...(typeof payload.entryId === 'string' ? { entryId: payload.entryId } : {}),
          ...(typeof payload.collectionSlug === 'string'
            ? { collectionSlug: payload.collectionSlug }
            : {}),
        },
        deps.env?.FRONTEND_REVALIDATE_SECRET,
        deps.fetchImpl
      )
      if (!result.success) throw new Error(result.error ?? 'frontend revalidation failed')
      return
    }
    case 'rag_index': {
      if (!entryId) return
      await ragService.indexPublishedEntry(deps.db, deps.env, entryId, tenantId, {
        throwOnError: true,
      })
      return
    }
    case 'fts_sync': {
      if (!entryId) return
      // Converge on the entry's current state, so a late retry never
      // re-indexes an entry that was unpublished or deleted since.
      const entry = await entriesRepository.findById(deps.db, entryId, tenantId)
      const ok =
        entry && entry.status === 'published'
          ? await ftsService.syncPublishedEntry(deps.db, { ...entry, tenantId: tenantId ?? null })
          : await ftsService.removeEntry(deps.db, entryId, tenantId)
      if (!ok) throw new Error('FTS sync failed')
      return
    }
    default: {
      throw new Error(`unknown side-effect kind '${String((intent as { kind: unknown }).kind)}'`)
    }
  }
}

function backoffAt(attempts: number, now = Date.now()): string {
  const delay = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)
  return new Date(now + delay).toISOString()
}

/** Mark-tolerant update: mock drivers without `update` are a no-op. */
async function updateIntents(
  db: Database,
  where: unknown,
  values: Record<string, unknown>
): Promise<void> {
  const updateFn = (db as unknown as { update?: unknown }).update
  if (typeof updateFn !== 'function') return
  const chain = (
    updateFn as (table: typeof sideEffectIntents) => { set: (v: Record<string, unknown>) => unknown }
  ).call(db, sideEffectIntents).set(values) as { where?: (cond: unknown) => Promise<unknown> }
  if (chain && typeof chain.where === 'function') await chain.where(where)
}

export type SideEffectRunResult = { done: string[]; failed: string[] }

/**
 * Run intents and record the outcome: `done`, or `pending` with a backoff
 * (`failed` after SIDE_EFFECT_MAX_ATTEMPTS). Never throws.
 */
export async function runSideEffectIntents(
  deps: SideEffectDeps,
  intents: SideEffectIntent[]
): Promise<SideEffectRunResult> {
  const result: SideEffectRunResult = { done: [], failed: [] }
  if (intents.length === 0) return result

  const outcomes = await Promise.allSettled(intents.map((intent) => executeIntent(deps, intent)))
  const nowIso = new Date().toISOString()

  const failures: { intent: SideEffectIntent; error: string }[] = []
  outcomes.forEach((outcome, index) => {
    const intent = intents[index]
    if (!intent) return
    if (outcome.status === 'fulfilled') {
      result.done.push(intent.id)
    } else {
      const reason = outcome.reason
      failures.push({ intent, error: reason instanceof Error ? reason.message : String(reason) })
      result.failed.push(intent.id)
    }
  })

  try {
    if (result.done.length > 0) {
      await updateIntents(deps.db, inArray(sideEffectIntents.id, result.done), {
        status: 'done',
        completedAt: nowIso,
        nextAttemptAt: null,
        lastError: null,
      })
    }
    for (const { intent, error } of failures) {
      const attempts = intent.attempts + 1
      const exhausted = attempts >= SIDE_EFFECT_MAX_ATTEMPTS
      logger.warn('side_effect_intent_failed', {
        intentId: intent.id,
        kind: intent.kind,
        attempts,
        exhausted,
        error,
      })
      await updateIntents(deps.db, eq(sideEffectIntents.id, intent.id), {
        status: exhausted ? 'failed' : 'pending',
        attempts,
        nextAttemptAt: exhausted ? null : backoffAt(attempts),
        lastError: error.slice(0, 500),
      })
    }
  } catch (err) {
    // The intents stay pending; the relay retries them.
    logger.warn('side_effect_intent_mark_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return result
}

type IntentRow = typeof sideEffectIntents.$inferSelect

/**
 * Claim and run pending intents whose retry time has come, oldest first.
 *
 * Each row is claimed with a compare-and-set update (same status, attempts
 * and next_attempt_at as read) that pushes next_attempt_at out by a lease, so
 * two relays never run the same row at once. `staleOnlyMs` skips rows newer
 * than that, so an opportunistic sweep never races the request that wrote
 * them. Never throws.
 */
export async function relaySideEffectIntents(
  deps: SideEffectDeps,
  opts: { limit?: number; staleOnlyMs?: number; now?: number } = {}
): Promise<SideEffectRunResult & { claimed: number }> {
  const empty = { claimed: 0, done: [], failed: [] }
  const now = opts.now ?? Date.now()
  const nowIso = new Date(now).toISOString()
  const db = deps.db as unknown as { select?: unknown; update?: unknown }
  // Mock drivers in unit tests have neither; real D1 and SQLite have both.
  if (typeof db.select !== 'function' || typeof db.update !== 'function') return empty
  try {
    const conditions = [
      eq(sideEffectIntents.status, 'pending'),
      or(isNull(sideEffectIntents.nextAttemptAt), lte(sideEffectIntents.nextAttemptAt, nowIso)),
    ]
    if (opts.staleOnlyMs && opts.staleOnlyMs > 0) {
      conditions.push(
        lte(sideEffectIntents.createdAt, new Date(now - opts.staleOnlyMs).toISOString())
      )
    }
    const rows = (await deps.db
      .select()
      .from(sideEffectIntents)
      .where(and(...conditions))
      .orderBy(asc(sideEffectIntents.createdAt))
      .limit(opts.limit ?? 20)) as IntentRow[]

    const leaseUntil = new Date(now + CLAIM_LEASE_MS).toISOString()
    const claimed: SideEffectIntent[] = []
    for (const row of rows) {
      const won = (await deps.db
        .update(sideEffectIntents)
        .set({ nextAttemptAt: leaseUntil })
        .where(
          and(
            eq(sideEffectIntents.id, row.id),
            eq(sideEffectIntents.status, 'pending'),
            eq(sideEffectIntents.attempts, row.attempts),
            row.nextAttemptAt === null
              ? isNull(sideEffectIntents.nextAttemptAt)
              : eq(sideEffectIntents.nextAttemptAt, row.nextAttemptAt)
          )
        )
        .returning({ id: sideEffectIntents.id })) as { id: string }[]
      if (won.length === 0) continue
      claimed.push({
        id: row.id,
        kind: row.kind as SideEffectKind,
        tenantScope: row.tenantScope,
        commandId: row.commandId,
        payload: row.payload ?? {},
        attempts: row.attempts,
      })
    }

    const run = await runSideEffectIntents(deps, claimed)
    return { claimed: claimed.length, ...run }
  } catch (err) {
    logger.warn('side_effect_relay_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return empty
  }
}
