import { describe, expect, it } from 'bun:test'
import {
  ACCESS_TOKEN_DEFAULT_TTL_SECONDS,
  createAccessToken,
  parseAccessClaims,
  validateRequestJwt,
} from '../../auth/jwt'
import {
  bumpAuthRevision,
  bumpPermissionRevision,
  getAuthRevision,
  getPermissionRevision,
  isRevisionFresh,
  isTokenFresh,
} from '../../auth/auth-revision'
import { resolveFastPathActor } from '../../auth/access-token-guard'

const SECRET = 'test-access-token-secret-32-chars!'

function createKv(store: Map<string, string> = new Map()): KVNamespace {
  return {
    get: async (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    put: async (key: string, value: string) => {
      store.set(key, value)
    },
  } as unknown as KVNamespace
}

describe('RBAC access tokens', () => {
  it('round-trips global + tenant claims through sign and verify', async () => {
    const token = await createAccessToken(
      { sub: 'u-1', role: 'admin', tid: 't-1', tsl: 'acme', trl: 'owner', rv: 0, pv: 0 },
      SECRET,
      { issuer: 'edgecms', audience: 'admin' }
    )
    const request = new Request('http://localhost/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const result = await validateRequestJwt(request, {
      secret: SECRET,
      issuer: 'edgecms',
      audience: 'admin',
    })
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('Expected valid JWT')
    const claims = parseAccessClaims(result.payload)
    expect(claims).toMatchObject({
      sub: 'u-1',
      role: 'admin',
      tid: 't-1',
      tsl: 'acme',
      trl: 'owner',
      rv: 0,
      pv: 0,
    })
  })

  it('defaults to a 10-minute TTL', async () => {
    expect(ACCESS_TOKEN_DEFAULT_TTL_SECONDS).toBe(600)
    const before = Math.floor(Date.now() / 1000)
    const token = await createAccessToken({ sub: 'u-1' }, SECRET)
    const [, payloadPart] = token.split('.')
    const payload = JSON.parse(atob(payloadPart as string))
    expect(payload.exp - payload.iat).toBe(600)
    expect(payload.iat).toBeGreaterThanOrEqual(before)
  })

  it('rejects payloads without a subject', () => {
    expect(parseAccessClaims({})).toBeUndefined()
    expect(parseAccessClaims(null)).toBeUndefined()
    expect(parseAccessClaims({ sub: '' })).toBeUndefined()
  })
})

describe('auth revisions', () => {
  it('treats young tokens as fresh without a KV read', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isTokenFresh(now)).toBe(true)
    expect(isTokenFresh(now - 30)).toBe(true)
    expect(isTokenFresh(now - 61)).toBe(false)
    expect(isTokenFresh(undefined)).toBe(false)
  })

  it('detects stale revisions after a bump', async () => {
    const kv = createKv()
    expect(await getAuthRevision(kv, 'u-1', 't-1')).toBeUndefined()
    const token = await createAccessToken({ sub: 'u-1', rv: 0, pv: 0 }, SECRET)

    const request = new Request('http://localhost/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const result = await validateRequestJwt(request, { secret: SECRET })
    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('Expected valid JWT')
    const claims = parseAccessClaims(result.payload)
    expect(claims?.rv).toBe(0)

    await bumpAuthRevision(kv, 'u-1', 't-1')
    const storedRv = await getAuthRevision(kv, 'u-1', 't-1')
    expect(storedRv).toBe(1)
    expect(
      isRevisionFresh({ tokenRv: claims?.rv, tokenPv: claims?.pv, storedRv, storedPv: 0 })
    ).toBe(false)
  })

  it('bumps permission revisions independently per tenant', async () => {
    const kv = createKv()
    await bumpPermissionRevision(kv, 't-1')
    await bumpPermissionRevision(kv, 't-1')
    expect(await getPermissionRevision(kv, 't-1')).toBe(2)
    expect(await getPermissionRevision(kv, 't-2')).toBeUndefined()
  })

  it('treats unknown stored revisions as fresh (fail-open to TTL)', () => {
    expect(isRevisionFresh({ tokenRv: 0, tokenPv: 0 })).toBe(true)
  })
})

describe('resolveFastPathActor', () => {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    sub: 'u-1',
    role: 'admin',
    tid: 't-1',
    tsl: 'acme',
    trl: 'owner',
    rv: 0,
    pv: 0,
    iat: now,
  }

  it('hits on fresh claims without touching KV', async () => {
    const kv = createKv()
    const result = await resolveFastPathActor({ claims, tenantSlug: 'acme', kv })
    expect(result.kind).toBe('hit')
    if (result.kind !== 'hit') throw new Error('Expected hit')
    expect(result.actor).toMatchObject({ actorId: 'u-1', tenantId: 't-1', tenantRole: 'owner' })
    expect(kv.get).toBeDefined()
  })

  it('misses on slug mismatch so the caller falls back to DB', async () => {
    const result = await resolveFastPathActor({ claims, tenantSlug: 'other', kv: createKv() })
    expect(result).toEqual({ kind: 'miss' })
  })

  it('returns stale after a revision bump on an aged token', async () => {
    const kv = createKv()
    const aged = { ...claims, iat: now - 120 }
    const before = await resolveFastPathActor({ claims: aged, tenantSlug: 'acme', kv })
    expect(before.kind).toBe('hit')
    await bumpAuthRevision(kv, 'u-1', 't-1')
    const after = await resolveFastPathActor({ claims: aged, tenantSlug: 'acme', kv })
    expect(after).toEqual({ kind: 'stale' })
  })

  it('returns stale after a permission bump on an aged token', async () => {
    const kv = createKv()
    const aged = { ...claims, iat: now - 120 }
    await bumpPermissionRevision(kv, 't-1')
    const result = await resolveFastPathActor({ claims: aged, tenantSlug: 'acme', kv })
    expect(result).toEqual({ kind: 'stale' })
  })

  it('keeps custom role names as hit with a DB-permissions follow-up marker', async () => {
    const result = await resolveFastPathActor({
      claims: { ...claims, trl: 'support-lead' },
      tenantSlug: 'acme',
      kv: createKv(),
    })
    expect(result.kind).toBe('hit')
    if (result.kind !== 'hit') throw new Error('Expected hit')
    expect(result.actor.customTenantRole).toBe('support-lead')
  })
})
