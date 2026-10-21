import { scheduleDeferredWork } from '@/commands/deferred-work'
import { createDb, type Database } from '@/database/db'
import { logger } from '@/observability/logger'
import { type UsageRollupDelta, usageRepository } from '@/usage/usage.repository'

/**
 * Usage metering (HS-05).
 *
 * The framework reports per-tenant usage to the host's `usageSink`. Recording
 * is fire-and-forget: it runs after the handler through `waitUntil`, and a
 * sink that throws, rejects or hangs never fails or delays the request.
 */

/** Metered quantities. `media_bytes` and `entries` are signed deltas of a stored total. */
export type UsageMetric =
  /** Successful public REST or GraphQL read served by the Worker (CDN hits are not seen). */
  | 'public_reads'
  /** Executed (non dry-run) top-level command; a transaction counts once. */
  | 'admin_mutations'
  /** AI tokens (input + output) for one model call; `detail` is the model tier. */
  | 'ai_tokens'
  /** Bytes added (+) or removed (-) from media storage (original upload size). */
  | 'media_bytes'
  /** Entries created (+1) or deleted (-1). */
  | 'entries'

export interface UsageEvent {
  tenantId: string
  tenantSlug?: string
  metric: UsageMetric
  quantity: number
  /** Breakdown key: the AI model tier (`nano`, `mid`, `heavy`) for `ai_tokens`. */
  detail?: string
  /** ISO 8601 time the usage happened. */
  timestamp: string
}

export interface UsageSink {
  /**
   * Receives usage events. Called inside `waitUntil` after the response is
   * built; keep it non-blocking (buffer or enqueue). Errors are logged and dropped.
   */
  record(events: UsageEvent[]): void | Promise<void>
}

export type UsageEventInput = Omit<UsageEvent, 'timestamp'> & { timestamp?: string }

/** Records usage for one app instance. */
export interface UsageRecorder {
  /**
   * Hand events to the sink without blocking. `source` is the request or
   * handler context carrying `waitUntil`. Events without a tenant or with a
   * zero quantity are skipped.
   */
  record(source: unknown, events: UsageEventInput | UsageEventInput[]): void
}

export const noopUsageSink: UsageSink = { record: () => {} }

export function createUsageRecorder(sink: UsageSink | undefined): UsageRecorder {
  if (!sink || sink === noopUsageSink) return { record: () => {} }
  return {
    record(source, input) {
      const timestamp = new Date().toISOString()
      const events = (Array.isArray(input) ? input : [input])
        .filter((e) => !!e.tenantId && Number.isFinite(e.quantity) && e.quantity !== 0)
        .map((e) => ({ ...e, timestamp: e.timestamp ?? timestamp }))
      if (events.length === 0) return
      // Deferred to a microtask so a sink that throws synchronously becomes a
      // logged rejection instead of an error in the request path.
      const work = Promise.resolve().then(() => sink.record(events))
      scheduleDeferredWork(source, work, 'usage-sink')
    },
  }
}

export interface D1UsageRollupSinkOptions {
  /** D1 binding (or a getter, for bindings only available per request). */
  db: D1Database | Database | (() => D1Database | Database)
  /** Flush at most this often (ms). Default 10 000. `0` flushes on every record. */
  flushIntervalMs?: number
  /** Flush early once this many distinct rows are buffered. Default 50. */
  maxBufferedRows?: number
  now?: () => number
}

export interface D1UsageRollupSink extends UsageSink {
  /** Write all buffered rows now. */
  flush(): Promise<void>
}

/** A Drizzle instance has `select`; a raw D1 binding does not. */
function isDrizzle(value: unknown): value is Database {
  return typeof value === 'object' && value !== null && typeof (value as Database).select === 'function'
}

/**
 * Opt-in sink that sums events into `usage_daily` (migration
 * `0032_usage_daily.sql`), one row per tenant, UTC day, metric and detail.
 *
 * Events are buffered in the isolate and written in one D1 batch at most every
 * `flushIntervalMs`, so a busy tenant costs one D1 write per interval rather
 * than one per request. Buffered counts are lost if the isolate is evicted
 * before the next flush: treat the rollups as approximate. Hosts that bill on
 * usage should use a Queue-backed sink instead.
 */
export function createD1UsageRollupSink(options: D1UsageRollupSinkOptions): D1UsageRollupSink {
  const flushIntervalMs = options.flushIntervalMs ?? 10_000
  const maxBufferedRows = options.maxBufferedRows ?? 50
  const now = options.now ?? Date.now
  let buffer = new Map<string, UsageRollupDelta>()
  let lastFlushAt = now()

  const resolveDb = (): Database => {
    const raw = typeof options.db === 'function' ? options.db() : options.db
    return isDrizzle(raw) ? raw : createDb(raw as D1Database)
  }

  const add = (delta: UsageRollupDelta) => {
    const key = `${delta.tenantId}\u0000${delta.day}\u0000${delta.metric}\u0000${delta.detail}`
    const existing = buffer.get(key)
    if (existing) existing.value += delta.value
    else buffer.set(key, { ...delta })
  }

  const flush = async () => {
    if (buffer.size === 0) return
    const pending = buffer
    buffer = new Map()
    lastFlushAt = now()
    const deltas = [...pending.values()].filter((d) => d.value !== 0)
    try {
      await usageRepository.addDailyDeltas(resolveDb(), deltas)
    } catch (err) {
      // Keep the counts for the next flush unless the buffer is already large.
      if (buffer.size < maxBufferedRows * 10) for (const d of deltas) add(d)
      logger.warn('usage_rollup_flush_failed', {
        rows: deltas.length,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    record(events) {
      for (const event of events) {
        add({
          tenantId: event.tenantId,
          day: event.timestamp.slice(0, 10),
          metric: event.metric,
          detail: event.detail ?? '',
          value: Math.trunc(event.quantity),
        })
      }
      if (buffer.size >= maxBufferedRows || now() - lastFlushAt >= flushIntervalMs) {
        return flush()
      }
    },
    flush,
  }
}
