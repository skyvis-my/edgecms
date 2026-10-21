import { scheduleDeferredWork } from '@/commands/deferred-work'
import { logger } from '@/observability/logger'
import { createErrorEnvelope } from '@/shared/utils/service-response'
import type { TenantEventPublisher } from './tenant-events'

/**
 * Limit policy (HS-06).
 *
 * The host's `TenantLimits` provider is asked before commands, entry
 * creation, uploads, AI calls and tenant creation. A denial becomes
 * `402 QUOTA_EXCEEDED` (quota) or `429 RATE_LIMITED` (rate) with the
 * dimension and the host's upgrade URL, and emits `tenant.limit_reached`.
 */

export type LimitDimension =
  /** One top-level command (`amount` 1). */
  | 'commands'
  /** One new entry from `createEntry` (`amount` 1). */
  | 'entries'
  /** Media storage; `amount` is the upload size in bytes. */
  | 'media_bytes'
  /** AI tokens. `amount` is 0: the cost is unknown before the call, so deny when no budget is left. */
  | 'ai_tokens'
  /** A new tenant (`amount` 1). `tenant` is absent; `actor` is set. */
  | 'tenants'

/** Tenant fields passed to the provider, including the tenant-row media limits (MD-05). */
export interface LimitTenant {
  id: string
  slug: string
  name: string
  status: string
  mediaUploadMaxBytes?: number
  mediaUploadMaxDimension?: number
}

export interface LimitCheck {
  dimension: LimitDimension
  amount: number
  tenant?: LimitTenant
  actor?: { userId: string; email?: string }
}

export interface LimitDenial {
  allowed: false
  /** `quota` → 402 QUOTA_EXCEEDED, `rate` → 429 RATE_LIMITED. Default `quota`. */
  kind?: 'quota' | 'rate'
  message?: string
  limit?: number
  used?: number
  /** Absolute http(s) URL the admin links to. Other values are dropped. */
  upgradeUrl?: string
  /** Sent as `Retry-After` for rate denials. */
  retryAfterSeconds?: number
  /**
   * Period the limit belongs to (for example a billing month, `2026-10`).
   * `tenant.limit_reached` fires once per tenant, dimension and period.
   * Default: the UTC day.
   */
  period?: string
}

/** `true` allows; `false` is a quota denial without details. */
export type LimitDecision = boolean | { allowed: true } | LimitDenial

export interface TenantLimits {
  check(input: LimitCheck): LimitDecision | Promise<LimitDecision>
}

/**
 * Default provider: allows everything. The tenant-row media limits (size,
 * dimension, file type) stay enforced by the upload path itself (413/415),
 * with or without a host, and are passed to custom providers in `tenant`.
 */
export const defaultTenantLimits: TenantLimits = { check: () => true }

export interface LimitExceeded {
  status: 402 | 429
  code: 'QUOTA_EXCEEDED' | 'RATE_LIMITED'
  message: string
  details: {
    dimension: LimitDimension
    kind: 'quota' | 'rate'
    limit?: number
    used?: number
    upgradeUrl?: string
    retryAfterSeconds?: number
  }
}

/** Keep only absolute http(s) URLs so the admin never renders a script URL. */
export function sanitizeUpgradeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function toLimitExceeded(dimension: LimitDimension, denial: LimitDenial): LimitExceeded {
  const kind = denial.kind === 'rate' ? 'rate' : 'quota'
  const upgradeUrl = sanitizeUpgradeUrl(denial.upgradeUrl)
  const limit = finitePositive(denial.limit)
  const used = finitePositive(denial.used)
  const retryAfterSeconds = finitePositive(denial.retryAfterSeconds)
  const message =
    typeof denial.message === 'string' && denial.message
      ? denial.message
      : kind === 'rate'
        ? `Rate limit reached for ${dimension}`
        : `Quota exceeded for ${dimension}`
  return {
    status: kind === 'rate' ? 429 : 402,
    code: kind === 'rate' ? 'RATE_LIMITED' : 'QUOTA_EXCEEDED',
    message,
    details: {
      dimension,
      kind,
      ...(limit !== undefined && { limit }),
      ...(used !== undefined && { used }),
      ...(upgradeUrl && { upgradeUrl }),
      ...(kind === 'rate' && retryAfterSeconds !== undefined && {
        retryAfterSeconds: Math.ceil(retryAfterSeconds),
      }),
    },
  }
}

/** Set the HTTP status (and `Retry-After`) and return the error envelope. */
export function respondLimitExceeded(
  set: { status?: unknown; headers: Record<string, unknown> },
  exceeded: LimitExceeded
) {
  set.status = exceeded.status
  if (exceeded.details.retryAfterSeconds !== undefined) {
    set.headers['Retry-After'] = String(exceeded.details.retryAfterSeconds)
  }
  return createErrorEnvelope(exceeded.code, exceeded.message, exceeded.details)
}

/** Checks limits for one app instance and reports crossings. */
export interface LimitEnforcer {
  /** `null` when allowed. `source` carries `waitUntil` for the crossing event. */
  check(source: unknown, input: LimitCheck): Promise<LimitExceeded | null>
}

export interface LimitEnforcerOptions {
  limits?: TenantLimits
  events?: Pick<TenantEventPublisher, 'publish'>
  /** KV used to emit `tenant.limit_reached` once across isolates. */
  kv?: () => KVNamespace | undefined
}

const LIMIT_MARKER_PREFIX = 'limit-reached:'
const LIMIT_MARKER_TTL_SECONDS = 40 * 24 * 60 * 60
const MAX_SEEN_MARKERS = 10_000

function normalizeDecision(decision: LimitDecision): LimitDenial | null {
  if (decision === true) return null
  if (decision === false || !decision || typeof decision !== 'object') return { allowed: false }
  return decision.allowed === true ? null : decision
}

export function createLimitEnforcer(options: LimitEnforcerOptions = {}): LimitEnforcer {
  const limits = options.limits
  if (!limits || limits === defaultTenantLimits) {
    return { check: async () => null }
  }
  // Crossings already reported by this instance; KV dedupes across isolates.
  const seen = new Set<string>()

  const reportCrossing = async (input: LimitCheck, denial: LimitDenial, exceeded: LimitExceeded) => {
    const tenant = input.tenant
    if (!tenant || !options.events) return
    const period = denial.period || new Date().toISOString().slice(0, 10)
    const marker = `${tenant.id}:${input.dimension}:${period}`
    if (seen.has(marker)) return
    if (seen.size >= MAX_SEEN_MARKERS) seen.clear()
    seen.add(marker)
    const kv = options.kv?.()
    if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
      const kvKey = `${LIMIT_MARKER_PREFIX}${marker}`
      try {
        if (await kv.get(kvKey)) return
        await kv.put(kvKey, '1', { expirationTtl: LIMIT_MARKER_TTL_SECONDS })
      } catch (err) {
        logger.warn('limit_marker_kv_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    await options.events.publish('tenant.limit_reached', tenant, {
      actorId: input.actor?.userId,
      limit: { ...exceeded.details, period },
    })
  }

  return {
    async check(source, input) {
      let denial: LimitDenial | null
      try {
        denial = normalizeDecision(await limits.check(input))
      } catch (err) {
        // Fail open: a broken limits provider must not take the CMS down.
        logger.error('host_limits_check_failed', {
          dimension: input.dimension,
          tenantId: input.tenant?.id,
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      }
      if (!denial) return null
      const exceeded = toLimitExceeded(input.dimension, denial)
      scheduleDeferredWork(source, reportCrossing(input, denial, exceeded), 'tenant-limit-reached')
      return exceeded
    },
  }
}

/** Build the provider's tenant view from a tenant row or tenant context. */
export function toLimitTenant(tenant: LimitTenant): LimitTenant {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    status: tenant.status,
    ...(tenant.mediaUploadMaxBytes !== undefined && {
      mediaUploadMaxBytes: tenant.mediaUploadMaxBytes,
    }),
    ...(tenant.mediaUploadMaxDimension !== undefined && {
      mediaUploadMaxDimension: tenant.mediaUploadMaxDimension,
    }),
  }
}
