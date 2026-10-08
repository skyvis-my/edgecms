import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCachedSession, getSessionWithLocalCache, writeCachedSession } from './session-fetch'

describe('getSessionWithLocalCache', () => {
  beforeEach(() => {
    clearCachedSession()
  })

  it('returns cached session without calling remote when local session is not expired', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    writeCachedSession({
      user: { id: 'u1', email: 'user@example.com' },
      session: { id: 's1', expiresAt },
    })

    const fetchSession = vi.fn(async () => ({ data: null, error: null }))

    const result = await getSessionWithLocalCache(fetchSession)

    expect(fetchSession).not.toHaveBeenCalled()
    expect(result.data?.session.id).toBe('s1')
  })

  it('calls remote when local session is expired', async () => {
    const expiresAt = new Date(Date.now() - 60_000).toISOString()
    writeCachedSession({
      user: { id: 'u1', email: 'user@example.com' },
      session: { id: 's1', expiresAt },
    })

    const fetchSession = vi.fn(async () => ({
      data: {
        user: { id: 'u2', email: 'next@example.com' },
        session: { id: 's2', expiresAt: new Date(Date.now() + 60_000).toISOString() },
      },
      error: null,
    }))

    const result = await getSessionWithLocalCache(fetchSession)

    expect(fetchSession).toHaveBeenCalledTimes(1)
    expect(result.data?.session.id).toBe('s2')
  })

  it('calls remote when forced (new login)', async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    writeCachedSession({
      user: { id: 'u1', email: 'user@example.com' },
      session: { id: 's1', expiresAt },
    })

    const fetchSession = vi.fn(async () => ({
      data: {
        user: { id: 'u1', email: 'user@example.com' },
        session: { id: 's1', expiresAt },
      },
      error: null,
    }))

    await getSessionWithLocalCache(fetchSession, { forceRefresh: true })

    expect(fetchSession).toHaveBeenCalledTimes(1)
  })

  it('does not require localStorage availability to cache sessions', async () => {
    const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('localStorage unavailable')
      },
    })

    try {
      const expiresAt = new Date(Date.now() + 60_000).toISOString()
      writeCachedSession({
        user: { id: 'u1', email: 'user@example.com' },
        session: { id: 's1', expiresAt },
      })

      const fetchSession = vi.fn(async () => ({
        data: {
          user: { id: 'u2', email: 'next@example.com' },
          session: { id: 's2', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        },
        error: null,
      }))

      const result = await getSessionWithLocalCache(fetchSession)
      expect(result.data?.session.id).toBe('s1')
      expect(fetchSession).not.toHaveBeenCalled()
    } finally {
      if (localStorageDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor)
      } else {
        Reflect.deleteProperty(globalThis, 'localStorage')
      }
    }
  })
})
