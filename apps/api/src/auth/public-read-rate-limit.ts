import {
  consumeRateLimit,
  consumeRateLimitDistributed,
  DEFAULT_RATE_LIMIT_POLICIES,
  type RateLimitPolicy,
} from './rate-limit.middleware'

/** Structural type of a Cloudflare Workers rate-limiting binding. */
export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number }

export type PublicReadRateLimitEnv = {
  CACHE?: KVNamespace
  /** Optional `[[ratelimits]]` binding; its limit and period come from wrangler config. */
  PUBLIC_READ_RATE_LIMITER?: RateLimitBinding
  /** `kv` restores the KV-backed counter (one KV read per public read). */
  PUBLIC_READ_RATE_LIMIT_STORE?: string
}

function isRateLimitBinding(value: unknown): value is RateLimitBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { limit?: unknown }).limit === 'function'
  )
}

function isFrameworkPolicy(policy: RateLimitPolicy): boolean {
  const fallback = DEFAULT_RATE_LIMIT_POLICIES.public_read
  return policy.windowMs === fallback.windowMs && policy.limit === fallback.limit
}

/**
 * DL-10: rate limit a public read without a KV round trip before the cache.
 *
 * - `PUBLIC_READ_RATE_LIMITER` binding present and the caller bucket uses the
 *   framework policy: the binding decides (no KV, counted per Cloudflare location).
 * - `PUBLIC_READ_RATE_LIMIT_STORE=kv`: the previous KV-backed counter.
 * - Otherwise, and when the binding throws: an in-isolate counter. Each
 *   isolate counts on its own, so the effective limit is approximate.
 */
export async function consumePublicReadRateLimit(
  key: string,
  policy: RateLimitPolicy,
  env: PublicReadRateLimitEnv,
  options: { bucket: 'caller' | 'tenant'; source?: unknown; now?: number } = { bucket: 'caller' }
): Promise<RateLimitResult> {
  const now = options.now ?? Date.now()
  const binding = env.PUBLIC_READ_RATE_LIMITER
  if (options.bucket === 'caller' && isRateLimitBinding(binding) && isFrameworkPolicy(policy)) {
    try {
      const outcome = await binding.limit({ key })
      // The binding does not report a count; `remaining` is only a hint.
      return {
        allowed: outcome.success === true,
        remaining: outcome.success === true ? 1 : 0,
        resetAt: now + policy.windowMs,
      }
    } catch {
      // Binding unavailable: fall through to the isolate counter.
    }
  }
  if (env.PUBLIC_READ_RATE_LIMIT_STORE === 'kv') {
    return consumeRateLimitDistributed(key, {
      kv: env.CACHE,
      now,
      windowMs: policy.windowMs,
      limit: policy.limit,
      source: options.source,
    })
  }
  return consumeRateLimit(key, now, policy.windowMs, policy.limit)
}
