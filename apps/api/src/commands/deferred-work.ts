import { logger } from '@/observability/logger'

/**
 * Deferred background work scheduler.
 *
 * Mirrors the `getDeferredWorkScheduler` pattern from the assets controller:
 * when a Cloudflare `waitUntil` is available on the execution context, long-tail
 * side effects (CDN purges, revalidation webhooks, outbox sweeps, RAG indexing,
 * DO notifications) are attached to it so the worker stays alive without
 * delaying the response. Otherwise the work still runs, detached via `void`,
 * with rejections caught and logged instead of surfacing as unhandled.
 */

/** Minimal structural type for Cloudflare's ExecutionContext. */
export type WaitUntilContext = {
  waitUntil: (promise: Promise<unknown>) => void
}

/** Schedules detached background work. */
export type DeferredWorkScheduler = (promise: Promise<unknown>) => void

/** Anything that may carry a `waitUntil` — Elysia request ctx or CommandContext. */
function readWaitUntil(source: unknown): ((promise: Promise<unknown>) => void) | undefined {
  if (!source || typeof source !== 'object') return undefined
  const record = source as Record<string, unknown>
  // Elysia request-context shape: `ctx.waitUntil` (mirrors assets.controller).
  if (typeof record.waitUntil === 'function') {
    const waitUntil = record.waitUntil as (promise: Promise<unknown>) => void
    return (promise) => waitUntil.call(source, promise)
  }
  // CommandContext shape: `ctx.executionCtx.waitUntil`.
  const executionCtx = record.executionCtx
  if (executionCtx && typeof executionCtx === 'object') {
    const nested = (executionCtx as Record<string, unknown>).waitUntil
    if (typeof nested === 'function') {
      const holder = executionCtx as WaitUntilContext
      return (promise) => holder.waitUntil(promise)
    }
  }
  return undefined
}

/**
 * Resolve a deferred-work scheduler from a request/handler context.
 * Returns `undefined` when no `waitUntil` is available (tests, DO alarm
 * invocations, non-worker runtimes) — callers then `await` or `void` directly.
 */
export function getDeferredWorkScheduler(source: unknown): DeferredWorkScheduler | undefined {
  return readWaitUntil(source)
}

/**
 * Run background work without blocking the response.
 *
 * Uses `waitUntil` when available; otherwise detaches with `void`.
 * Rejections are always caught and logged — deferred work must never produce
 * unhandled rejections or fail the mutation it follows.
 */
export function scheduleDeferredWork(
  source: unknown,
  promise: Promise<unknown>,
  task: string
): void {
  const guarded = promise.catch((err: unknown) => {
    logger.warn('deferred_work_failed', {
      task,
      error: err instanceof Error ? err.message : String(err),
    })
  })
  const scheduler = getDeferredWorkScheduler(source)
  if (scheduler) {
    try {
      scheduler(guarded)
      return
    } catch (err) {
      logger.warn('deferred_work_schedule_failed', {
        task,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  void guarded
}
