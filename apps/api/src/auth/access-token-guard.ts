import type { ActorRole, TenantActorRole } from './rbac'
import type { AccessTokenClaims } from './jwt'
import {
  getAuthRevision,
  getPermissionRevision,
  isRevisionFresh,
  isTokenFresh,
} from './auth-revision'

export type FastPathActor = {
  actorId: string
  actorRole?: ActorRole
  actorEmail?: string
  isSuperAdminByToken?: boolean
  /** Session behind the token completed a second factor. */
  mfaVerified?: boolean
  tenantId?: string
  tenantRole?: TenantActorRole
  customTenantRole?: string
}

export type FastPathResult = { kind: 'hit'; actor: FastPathActor } | { kind: 'stale' } | { kind: 'miss' }

function asFastPathActorRole(role: string | undefined): ActorRole | undefined {
  if (role === 'viewer' || role === 'editor' || role === 'admin') return role
  return undefined
}

function asFastPathTenantRole(role: string | undefined): TenantActorRole | undefined {
  if (
    role === 'viewer' ||
    role === 'member' ||
    role === 'editor' ||
    role === 'admin' ||
    role === 'owner'
  ) {
    return role
  }
  return undefined
}

/**
 * Stateless fast path: trust signature-verified RBAC claims instead of D1 reads.
 *
 * - `hit`: claims cover this request; use `actor` with zero D1 reads.
 * - `stale`: claims are for this tenant but a revision bump invalidated them.
 *   Caller must reject with `TOKEN_STALE` so the client refreshes — never
 *   silently fall back, or role demotions would stay effective until TTL expiry.
 * - `miss`: token cannot cover this request (wrong tenant, global-only token
 *   on a tenant route, unrecognized shape). Caller falls back to the D1 path.
 */
export async function resolveFastPathActor(input: {
  claims: AccessTokenClaims
  tenantSlug: string | undefined
  kv: Pick<KVNamespace, 'get'> | undefined
}): Promise<FastPathResult> {
  const { claims, tenantSlug, kv } = input
  const actorRole = asFastPathActorRole(claims.role)

  if (tenantSlug) {
    // Token covers exactly one tenant; slug mismatch (rename or foreign
    // tenant) must fall back to DB rather than mis-authorize.
    if (!claims.tid || !claims.trl || claims.tsl !== tenantSlug) return { kind: 'miss' }

    if (!isTokenFresh(claims.iat)) {
      const [storedRv, storedPv] = await Promise.all([
        getAuthRevision(kv, claims.sub, claims.tid),
        getPermissionRevision(kv, claims.tid),
      ])
      if (!isRevisionFresh({ tokenRv: claims.rv, tokenPv: claims.pv, storedRv, storedPv })) {
        return { kind: 'stale' }
      }
    }

    const base = {
      actorId: claims.sub,
      actorRole,
      actorEmail: claims.email,
      isSuperAdminByToken: claims.sa === 1,
      mfaVerified: claims.mfa === 1,
      tenantId: claims.tid,
    }
    const tenantRole = asFastPathTenantRole(claims.trl)
    if (tenantRole) {
      return { kind: 'hit', actor: { ...base, tenantRole } }
    }
    // Custom role name: identity is trusted, but permissions still need one DB read.
    if (claims.trl) {
      return { kind: 'hit', actor: { ...base, customTenantRole: claims.trl } }
    }
    return { kind: 'miss' }
  }

  if (!isTokenFresh(claims.iat)) {
    // Global-only token: TTL bounds staleness; KV has no global-role key yet.
  }
  return {
    kind: 'hit',
    actor: {
      actorId: claims.sub,
      actorRole,
      actorEmail: claims.email,
      isSuperAdminByToken: claims.sa === 1,
      mfaVerified: claims.mfa === 1,
    },
  }
}
