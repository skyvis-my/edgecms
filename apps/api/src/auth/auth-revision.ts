/**
 * KV-backed revision counters for stateless RBAC access tokens.
 *
 * No schema migration required: revisions live in CACHE (KV) only.
 * - `rv` (auth revision): bumped when a user's global role or a
 *   tenant membership changes.
 * - `pv` (permission revision): bumped when a tenant's roles or
 *   permissions change.
 *
 * Guard behavior: tokens fresher than CHECK_AFTER_SECONDS skip the KV
 * read entirely (zero I/O). Older tokens do a single cheap KV read;
 * on mismatch the guard falls back to the D1 source of truth and the
 * client refreshes via `GET /api/auth/access-token`.
 */

export const AUTH_REVISION_CHECK_AFTER_SECONDS = 60
export const AUTH_REVISION_KV_TTL_SECONDS = 60 * 60 * 24 * 7

function authRevisionKey(userId: string, tenantId: string): string {
  return `authrev:v1:${userId}:${tenantId}`
}

function permissionRevisionKey(tenantId: string): string {
  return `permrev:v1:${tenantId}`
}

function parseRevision(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) return undefined
  return value
}

async function kvGet(
  kv: Pick<KVNamespace, 'get'> | undefined,
  key: string
): Promise<string | null | undefined> {
  if (!kv) return undefined
  try {
    return await kv.get(key)
  } catch {
    return undefined
  }
}

/** Current auth revision for a user+tenant. Undefined = unknown (treat as fresh). */
export async function getAuthRevision(
  kv: Pick<KVNamespace, 'get'> | undefined,
  userId: string,
  tenantId: string
): Promise<number | undefined> {
  return parseRevision(await kvGet(kv, authRevisionKey(userId, tenantId)))
}

/** Current permission revision for a tenant. Undefined = unknown (treat as fresh). */
export async function getPermissionRevision(
  kv: Pick<KVNamespace, 'get'> | undefined,
  tenantId: string
): Promise<number | undefined> {
  return parseRevision(await kvGet(kv, permissionRevisionKey(tenantId)))
}

async function kvPut(
  kv: (Pick<KVNamespace, 'get'> & Partial<Pick<KVNamespace, 'put'>>) | undefined,
  key: string,
  value: number
): Promise<number> {
  if (kv?.put) {
    try {
      await kv.put(key, String(value), { expirationTtl: AUTH_REVISION_KV_TTL_SECONDS })
    } catch {
      // Best-effort: a failed bump only extends the stale window until TTL expiry.
    }
  }
  return value
}

/** Best-effort bump after membership/global-role changes. Returns new revision. */
export async function bumpAuthRevision(
  kv: (Pick<KVNamespace, 'get'> & Partial<Pick<KVNamespace, 'put'>>) | undefined,
  userId: string,
  tenantId: string
): Promise<number> {
  const current = (await getAuthRevision(kv, userId, tenantId)) ?? 0
  return kvPut(kv, authRevisionKey(userId, tenantId), current + 1)
}

/** Best-effort bump after role/permission definition changes. Returns new revision. */
export async function bumpPermissionRevision(
  kv: (Pick<KVNamespace, 'get'> & Partial<Pick<KVNamespace, 'put'>>) | undefined,
  tenantId: string
): Promise<number> {
  const current = (await getPermissionRevision(kv, tenantId)) ?? 0
  return kvPut(kv, permissionRevisionKey(tenantId), current + 1)
}

/** True when the token is young enough to skip the KV revision check. */
export function isTokenFresh(
  iat: number | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  thresholdSeconds: number = AUTH_REVISION_CHECK_AFTER_SECONDS
): boolean {
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return false
  return nowSeconds - iat < thresholdSeconds
}

/**
 * True when embedded revisions match (or are newer than) stored revisions.
 * Unknown stored revisions (KV miss) count as fresh — TTL expiry bounds risk.
 */
export function isRevisionFresh(input: {
  tokenRv?: number
  tokenPv?: number
  storedRv?: number
  storedPv?: number
}): boolean {
  if (input.storedRv !== undefined && input.tokenRv !== undefined) {
    if (input.tokenRv < input.storedRv) return false
  }
  if (input.storedPv !== undefined && input.tokenPv !== undefined) {
    if (input.tokenPv < input.storedPv) return false
  }
  return true
}
