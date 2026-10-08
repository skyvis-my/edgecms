const buckets = new Map<string, { count: number; resetAt: number }>()
const MAX_BUCKETS = 5000
const PRUNE_TARGET_SIZE = 4000
const KV_RATE_LIMIT_PREFIX = 'rate-limit:'

type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number }
export type RateLimitPolicy = { windowMs: number; limit: number }
const DEFAULT_POLICY: RateLimitPolicy = { windowMs: 60_000, limit: 120 }
const AUTH_POLICY: RateLimitPolicy = { windowMs: 60_000, limit: 30 }
const ADMIN_MUTATION_POLICY: RateLimitPolicy = { windowMs: 60_000, limit: 60 }
const AI_COMMAND_POLICY: RateLimitPolicy = { windowMs: 60_000, limit: 20 }
const PUBLIC_READ_POLICY: RateLimitPolicy = { windowMs: 60_000, limit: 300 }
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function pruneExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key)
    }
  }
}

function enforceBucketLimit(now: number): void {
  if (buckets.size <= MAX_BUCKETS) {
    return
  }
  pruneExpiredBuckets(now)
  if (buckets.size <= MAX_BUCKETS) {
    return
  }
  const sorted = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
  for (const [key] of sorted) {
    buckets.delete(key)
    if (buckets.size <= PRUNE_TARGET_SIZE) {
      break
    }
  }
}

export function getRateLimitKey(
  pathname: string,
  method: string,
  actorId: string | undefined,
  tenantSlug?: string,
  clientIp?: string
): string {
  const tenantScope = tenantSlug ?? 'global'
  const identity = actorId ? `user:${actorId}` : clientIp ? `ip:${clientIp}` : 'anon:shared'
  const normalizedPath = normalizePathForRateLimit(pathname)
  return `${tenantScope}:${identity}:${method.toUpperCase()}:${normalizedPath}`
}

export function getRateLimitPolicy(pathname: string, method: string): RateLimitPolicy {
  const normalizedMethod = method.toUpperCase()
  if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
    return AUTH_POLICY
  }
  if (pathname === '/api/csrf') {
    return AUTH_POLICY
  }
  if (
    pathname === '/api/admin/ai/command' ||
    pathname === '/api/admin/ai/workflow' ||
    pathname.endsWith('/admin/ai/command') ||
    pathname.endsWith('/admin/ai/workflow')
  ) {
    return AI_COMMAND_POLICY
  }
  if (
    !SAFE_METHODS.has(normalizedMethod) &&
    (pathname.startsWith('/api/admin/') || pathname.includes('/admin/'))
  ) {
    return ADMIN_MUTATION_POLICY
  }
  if (
    SAFE_METHODS.has(normalizedMethod) &&
    (pathname.startsWith('/api/public/') || pathname.includes('/public/'))
  ) {
    return PUBLIC_READ_POLICY
  }
  return DEFAULT_POLICY
}

export function consumeRateLimit(
  key: string,
  now = Date.now(),
  windowMs = 60_000,
  limit = 120
): RateLimitResult {
  enforceBucketLimit(now)
  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs }
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt }
  }

  bucket.count += 1
  buckets.set(key, bucket)
  return { allowed: true, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt }
}

export async function consumeRateLimitDistributed(
  key: string,
  options?: {
    kv?: KVNamespace
    now?: number
    windowMs?: number
    limit?: number
  }
): Promise<RateLimitResult> {
  const now = options?.now ?? Date.now()
  const windowMs = options?.windowMs ?? 60_000
  const limit = options?.limit ?? 120
  const kv = options?.kv

  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    return consumeRateLimit(key, now, windowMs, limit)
  }

  const kvKey = `${KV_RATE_LIMIT_PREFIX}${key}`
  const resetAt = now + windowMs

  try {
    const raw = await kv.get(kvKey)
    if (!raw) {
      const nextState = JSON.stringify({ count: 1, resetAt })
      await kv.put(kvKey, nextState, { expirationTtl: Math.max(1, Math.ceil(windowMs / 1000)) })
      return { allowed: true, remaining: limit - 1, resetAt }
    }

    const parsed = JSON.parse(raw) as { count?: number; resetAt?: number }
    const existingCount = typeof parsed.count === 'number' ? parsed.count : 0
    const existingResetAt = typeof parsed.resetAt === 'number' ? parsed.resetAt : resetAt

    if (now >= existingResetAt) {
      const nextState = JSON.stringify({ count: 1, resetAt })
      await kv.put(kvKey, nextState, { expirationTtl: Math.max(1, Math.ceil(windowMs / 1000)) })
      return { allowed: true, remaining: limit - 1, resetAt }
    }

    if (existingCount >= limit) {
      return { allowed: false, remaining: 0, resetAt: existingResetAt }
    }

    const updatedCount = existingCount + 1
    const ttlSeconds = Math.max(1, Math.ceil((existingResetAt - now) / 1000))
    await kv.put(kvKey, JSON.stringify({ count: updatedCount, resetAt: existingResetAt }), {
      expirationTtl: ttlSeconds,
    })
    return {
      allowed: true,
      remaining: Math.max(0, limit - updatedCount),
      resetAt: existingResetAt,
    }
  } catch {
    // Fail-open to in-memory limiter when distributed backend is unavailable.
    return consumeRateLimit(key, now, windowMs, limit)
  }
}

export function __resetRateLimitState() {
  buckets.clear()
}

function normalizePathForRateLimit(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return '/'

  if (
    segments[0] === 'api' &&
    segments[1] === 'tenants' &&
    segments[3] === 'api' &&
    segments[4] === 'admin'
  ) {
    const resource = segments[5] ?? 'root'
    return `/api/tenants/:tenant/api/admin/${resource}`
  }

  if (segments[0] === 'api' && segments[1] === 'admin') {
    const resource = segments[2] ?? 'root'
    return `/api/admin/${resource}`
  }

  if (segments[0] === 'api') {
    return `/api/${segments[1] ?? 'root'}`
  }

  return `/${segments[0]}`
}
