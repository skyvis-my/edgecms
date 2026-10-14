import { describe, expect, it, vi } from 'bun:test'
import {
  AUTH_REVISION_CHECK_AFTER_SECONDS,
  AUTH_REVISION_KV_TTL_SECONDS,
  bumpAuthRevision,
  bumpPermissionRevision,
  getAuthRevision,
  getPermissionRevision,
  isRevisionFresh,
  isTokenFresh,
} from '../../auth/auth-revision'

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
  } as unknown as KVNamespace & { store: Map<string, string> }
}

describe('auth-revision', () => {
  it('returns undefined for unknown revisions (treated as fresh)', async () => {
    const kv = fakeKv()
    expect(await getAuthRevision(kv, 'u1', 't1')).toBeUndefined()
    expect(await getPermissionRevision(kv, 't1')).toBeUndefined()
  })

  it('bumps user and tenant revisions monotonically with TTL', async () => {
    const kv = fakeKv()
    expect(await bumpAuthRevision(kv, 'u1', 't1')).toBe(1)
    expect(await bumpAuthRevision(kv, 'u1', 't1')).toBe(2)
    expect(await getAuthRevision(kv, 'u1', 't1')).toBe(2)
    // Other users/tenants are independent.
    expect(await getAuthRevision(kv, 'u2', 't1')).toBeUndefined()
    expect(await bumpPermissionRevision(kv, 't1')).toBe(1)
    expect(await getPermissionRevision(kv, 't1')).toBe(1)
    expect(kv.put).toHaveBeenCalledWith(
      expect.any(String),
      '1',
      { expirationTtl: AUTH_REVISION_KV_TTL_SECONDS }
    )
  })

  it('degrades without a KV binding', async () => {
    expect(await getAuthRevision(undefined, 'u1', 't1')).toBeUndefined()
    expect(await getPermissionRevision(undefined, 't1')).toBeUndefined()
    // Bumps still return the computed value (best-effort, nothing persisted).
    expect(await bumpAuthRevision(undefined, 'u1', 't1')).toBe(1)
  })

  it('treats young tokens as fresh without I/O', () => {
    const now = Math.floor(Date.now() / 1000)
    expect(isTokenFresh(now - 10, now)).toBe(true)
    expect(isTokenFresh(now - AUTH_REVISION_CHECK_AFTER_SECONDS - 1, now)).toBe(false)
    expect(isTokenFresh(undefined, now)).toBe(false)
  })

  it('rejects only older embedded revisions', () => {
    expect(isRevisionFresh({ tokenRv: 1, storedRv: 2 })).toBe(false)
    expect(isRevisionFresh({ tokenRv: 2, storedRv: 2 })).toBe(true)
    expect(isRevisionFresh({ tokenRv: 1, storedRv: undefined })).toBe(true)
    expect(isRevisionFresh({ tokenPv: 0, storedPv: 1 })).toBe(false)
  })
})
