/**
 * Scheduler Service
 *
 * Service wrapper for the CMS Worker to interact with the PublishScheduler
 * Durable Object. Provides high-level methods to schedule and cancel
 * publish/unpublish transitions.
 *
 * Reliability contract:
 * - Every DO response is checked (`response.ok`); non-OK responses throw.
 * - Transient failures (429 / 5xx / fetch throws / DO overload) are retried
 *   with bounded exponential backoff (max 3 attempts, 100–500ms delays).
 * - A fresh DO stub is created per attempt — a stub that threw is never reused.
 * - Every attempt is bounded by a 5s abort timeout so a wedged DO cannot
 *   stall the caller indefinitely. Aborts are NOT retried.
 */

import type { Env } from '@/env'
import { logger } from '@/observability/logger'

const SCHEDULER_DO_NAME = 'default'
const SCHEDULER_MAX_ATTEMPTS = 3
const SCHEDULER_BASE_BACKOFF_MS = 100
const SCHEDULER_MAX_BACKOFF_MS = 500
const SCHEDULER_FETCH_TIMEOUT_MS = 5000

export type SchedulerRequestOptions = {
  /** Override the abort signal (tests). Defaults to AbortSignal.timeout(5000). */
  signal?: AbortSignal
  /** Override the retry budget (tests). Clamped to 1..3. */
  maxAttempts?: number
}

/**
 * Error for failed scheduler DO requests.
 * `retryable` distinguishes transient (429/5xx/network) from permanent (4xx) failures.
 */
export class SchedulerRequestError extends Error {
  readonly status?: number
  readonly retryable: boolean

  constructor(message: string, opts?: { status?: number; retryable?: boolean }) {
    super(message)
    this.name = 'SchedulerRequestError'
    this.status = opts?.status
    this.retryable = opts?.retryable ?? false
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function backoffDelayMs(attempt: number): number {
  return Math.min(SCHEDULER_MAX_BACKOFF_MS, SCHEDULER_BASE_BACKOFF_MS * 2 ** attempt)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getAttemptSignal(explicit?: AbortSignal): AbortSignal | undefined {
  if (explicit) return explicit
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try {
      return AbortSignal.timeout(SCHEDULER_FETCH_TIMEOUT_MS)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * POST/GET against the scheduler DO with bounded retry.
 *
 * Creates a fresh stub per attempt: a stub whose fetch threw (e.g. DO
 * overload / connection reset) must not be reused for the next attempt.
 */
async function schedulerFetch(
  env: Env,
  path: string,
  init: RequestInit,
  opts?: SchedulerRequestOptions
): Promise<Response> {
  const maxAttempts = Math.min(
    SCHEDULER_MAX_ATTEMPTS,
    Math.max(1, Math.trunc(opts?.maxAttempts ?? SCHEDULER_MAX_ATTEMPTS))
  )
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Fresh stub per attempt — never reuse a stub after an exception.
    const stub = env.PUBLISH_SCHEDULER.get(env.PUBLISH_SCHEDULER.idFromName(SCHEDULER_DO_NAME))
    const signal = getAttemptSignal(opts?.signal)

    try {
      const response = await stub.fetch(`http://internal${path}`, {
        ...init,
        ...(signal ? { signal } : {}),
      })
      if (response.ok) return response

      const retryable = isRetryableStatus(response.status)
      const body = await response.text().catch(() => '')
      throw new SchedulerRequestError(
        `Scheduler DO request failed: ${path} returned status ${response.status}` +
          (body ? `: ${body.slice(0, 200)}` : ''),
        { status: response.status, retryable }
      )
    } catch (err) {
      // Tail-latency bound hit or permanent client error: never retry.
      if (isAbortError(err)) throw err
      if (err instanceof SchedulerRequestError && !err.retryable) throw err

      lastError = err
      if (attempt === maxAttempts - 1) break
      logger.warn('scheduler_request_retry', {
        path,
        attempt: attempt + 1,
        maxAttempts,
        error: err instanceof Error ? err.message : String(err),
      })
      await sleep(backoffDelayMs(attempt))
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new SchedulerRequestError(`Scheduler DO request failed: ${path}`, { retryable: true })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isPendingTransition(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.entryId !== 'string' || typeof value.scheduledAt !== 'string') return false
  return value.transitionType === 'publish' || value.transitionType === 'unpublish'
}

/**
 * Notify the scheduler of a pending publish/unpublish transition.
 *
 * Adds the transition to the DO's queue, which will fire an alarm
 * at the scheduled time to execute the transition.
 *
 * @param env - Cloudflare Worker environment bindings
 * @param entryId - The entry ID to transition
 * @param transitionType - 'publish' or 'unpublish'
 * @param scheduledAt - ISO 8601 timestamp when transition should occur
 */
export async function notifySchedule(
  env: Env,
  entryId: string,
  transitionType: 'publish' | 'unpublish',
  scheduledAt: string,
  metadata?: {
    collectionSlug?: string
    locales?: string[]
    tenantScope?: string
  },
  opts?: SchedulerRequestOptions
): Promise<void> {
  const response = await schedulerFetch(
    env,
    '/add',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entryId,
        transitionType,
        scheduledAt,
        collectionSlug: metadata?.collectionSlug,
        locales: metadata?.locales,
        tenantScope: metadata?.tenantScope,
      }),
    },
    opts
  )
  // Consume the body so the DO connection can be reused.
  await response.text().catch(() => '')
}

/**
 * Cancel a scheduled publish/unpublish transition.
 *
 * Removes the transition from the DO's queue.
 *
 * @param env - Cloudflare Worker environment bindings
 * @param entryId - The entry ID
 * @param transitionType - 'publish' or 'unpublish'
 */
export async function cancelSchedule(
  env: Env,
  entryId: string,
  transitionType: 'publish' | 'unpublish',
  opts?: SchedulerRequestOptions
): Promise<void> {
  const response = await schedulerFetch(
    env,
    '/remove',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entryId,
        transitionType,
      }),
    },
    opts
  )
  await response.text().catch(() => '')
}

/**
 * Get the current pending transitions queue (for debugging/monitoring).
 *
 * @param env - Cloudflare Worker environment bindings
 * @returns Array of pending transitions
 */
export async function getQueue(
  env: Env,
  opts?: SchedulerRequestOptions
): Promise<
  {
    entryId: string
    transitionType: 'publish' | 'unpublish'
    scheduledAt: string
  }[]
> {
  const response = await schedulerFetch(env, '/queue', { method: 'GET' }, opts)

  let data: unknown
  try {
    data = await response.json()
  } catch (err) {
    throw new SchedulerRequestError(
      `Scheduler DO request failed: /queue returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { status: response.status, retryable: false }
    )
  }
  if (!isRecord(data) || !Array.isArray(data.queue) || !data.queue.every(isPendingTransition)) {
    throw new SchedulerRequestError('Scheduler DO request failed: /queue returned malformed payload', {
      status: response.status,
      retryable: false,
    })
  }

  return data.queue as {
    entryId: string
    transitionType: 'publish' | 'unpublish'
    scheduledAt: string
  }[]
}
