import type { Database } from '@/database/db'
import type { AuditEventRow } from '@/database/schema'
import { logger } from '@/observability/logger'
import {
  AUDIT_GENESIS_HASH,
  AUDIT_PRUNE_ACTION,
  computeAuditHash,
  createAuditChainVerifier,
  redactAuditMetadata,
  subjectDigest,
  type AuditChainVerification,
} from './audit-chain'
import { auditRepository } from './audit.repository'

/** HS-12: audit events are kept for at least one year. */
export const MIN_AUDIT_RETENTION_DAYS = 365
/**
 * Retention is checked when an event lands on a multiple of this seq, or when
 * the previous event is older than a day (so quiet chains are pruned too).
 */
export const AUDIT_RETENTION_CHECK_INTERVAL = 100
const QUIET_CHAIN_CHECK_MS = 86_400_000
const MAX_APPEND_ATTEMPTS = 10
const VERIFY_PAGE_SIZE = 500
export const MAX_EXPORT_PAGE_SIZE = 1000

export type AuditCategory =
  | 'command'
  | 'auth'
  | 'rbac'
  | 'super_admin'
  | 'privacy'
  | 'audit'
  | 'settings'

export type AuditEventInput = {
  scope: string
  category: AuditCategory
  action: string
  outcome: 'success' | 'failure'
  actorId?: string | null
  actorSource: 'user' | 'ai' | 'system' | 'api_key' | string
  targetType?: string | null
  targetId?: string | null
  metadata?: Record<string, unknown>
  occurredAt?: string
}

export type AppendOptions = {
  /** Retention in days; values below the 365-day minimum are raised to it. */
  retentionDays?: number
  now?: () => Date
}

/**
 * Parse `AUDIT_RETENTION_DAYS`. Missing, invalid or too-small values fall
 * back to the 365-day minimum so a misconfiguration never shortens retention.
 */
export function resolveAuditRetentionDays(raw: string | number | undefined): number {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < MIN_AUDIT_RETENTION_DAYS) {
    return MIN_AUDIT_RETENTION_DAYS
  }
  return Math.floor(parsed)
}

function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const message = current instanceof Error ? current.message : String(current)
    if (/UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(message)) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

async function buildRow(
  input: AuditEventInput,
  head: { seq: number; hash: string } | null,
  occurredAt: string
): Promise<AuditEventRow> {
  const base = {
    id: crypto.randomUUID(),
    scope: input.scope,
    seq: (head?.seq ?? 0) + 1,
    category: input.category,
    action: input.action,
    outcome: input.outcome,
    actorId: input.actorId ?? null,
    actorDigest: await subjectDigest(input.actorId),
    actorSource: input.actorSource,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    targetDigest: await subjectDigest(input.targetId),
    metadata: redactAuditMetadata(input.metadata ?? {}) as Record<string, unknown>,
    occurredAt,
    prevHash: head?.hash ?? AUDIT_GENESIS_HASH,
  }
  return { ...base, hash: await computeAuditHash(base) }
}

async function appendOnce(
  db: Database,
  input: AuditEventInput,
  occurredAt: string
): Promise<{ row: AuditEventRow; previousAt: string | null }> {
  for (let attempt = 1; ; attempt += 1) {
    const head = await auditRepository.findHead(db, input.scope)
    const row = await buildRow(input, head, occurredAt)
    try {
      await auditRepository.insert(db, row)
      return { row, previousAt: head?.occurredAt ?? null }
    } catch (err) {
      // A concurrent writer took this seq; re-read the head and re-link.
      if (attempt >= MAX_APPEND_ATTEMPTS || !isUniqueViolation(err)) throw err
    }
  }
}

export const auditService = {
  /**
   * Append one event to its scope's chain. Throws on failure; callers on a
   * request path that must not fail use `recordSafely`.
   */
  async append(
    db: Database,
    input: AuditEventInput,
    options: AppendOptions = {}
  ): Promise<AuditEventRow> {
    const now = options.now?.() ?? new Date()
    const { row, previousAt } = await appendOnce(db, input, input.occurredAt ?? now.toISOString())
    const quietChain =
      previousAt !== null && now.getTime() - Date.parse(previousAt) > QUIET_CHAIN_CHECK_MS
    if (row.seq % AUDIT_RETENTION_CHECK_INTERVAL === 0 || quietChain) {
      await this.enforceRetention(db, input.scope, options).catch((err) => {
        logger.warn('audit_retention_failed', {
          scope: input.scope,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
    return row
  },

  /** Append without ever throwing; logs and returns null on failure. */
  async recordSafely(
    db: Database,
    input: AuditEventInput,
    options: AppendOptions = {}
  ): Promise<AuditEventRow | null> {
    try {
      return await this.append(db, input, options)
    } catch (err) {
      logger.error('audit_event_write_failed', {
        scope: input.scope,
        action: input.action,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  },

  /**
   * Remove events older than the retention window. The removal is itself
   * recorded in the chain first (seq and hash of the last removed event), so
   * `verify` can tell retention pruning apart from tampering.
   */
  async enforceRetention(
    db: Database,
    scope: string,
    options: AppendOptions = {}
  ): Promise<{ prunedThroughSeq: number } | null> {
    const retentionDays = resolveAuditRetentionDays(options.retentionDays)
    const now = options.now?.() ?? new Date()
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString()
    const latestExpired = await auditRepository.findLatestBefore(db, scope, cutoff)
    if (!latestExpired) return null

    await appendOnce(
      db,
      {
        scope,
        category: 'audit',
        action: AUDIT_PRUNE_ACTION,
        outcome: 'success',
        actorSource: 'system',
        metadata: {
          prunedThroughSeq: latestExpired.seq,
          prunedThroughHash: latestExpired.hash,
          retentionDays,
          cutoff,
        },
      },
      now.toISOString()
    )
    await auditRepository.deleteThroughSeq(db, scope, latestExpired.seq)
    return { prunedThroughSeq: latestExpired.seq }
  },

  /** One page of a scope's chain for export, oldest first, re-redacted. */
  async exportPage(db: Database, scope: string, afterSeq: number, limit: number) {
    const pageSize = Math.min(Math.max(1, Math.floor(limit)), MAX_EXPORT_PAGE_SIZE)
    const rows = await auditRepository.listPage(db, scope, Math.max(0, afterSeq), pageSize)
    const events = rows.map((row) => ({
      ...row,
      metadata: redactAuditMetadata(row.metadata ?? {}) as Record<string, unknown>,
    }))
    const head = await auditRepository.findHead(db, scope)
    return {
      scope,
      events,
      nextCursor: rows.length === pageSize ? rows[rows.length - 1]!.seq : null,
      head,
    }
  },

  /** Verify a scope's whole chain page by page. */
  async verify(db: Database, scope: string): Promise<AuditChainVerification> {
    const verifier = createAuditChainVerifier(scope)
    let afterSeq = 0
    for (;;) {
      const rows = await auditRepository.listPage(db, scope, afterSeq, VERIFY_PAGE_SIZE)
      for (const row of rows) {
        if (!(await verifier.push(row))) return verifier.result()
      }
      if (rows.length < VERIFY_PAGE_SIZE) break
      afterSeq = rows[rows.length - 1]!.seq
    }
    return verifier.result()
  },
}
