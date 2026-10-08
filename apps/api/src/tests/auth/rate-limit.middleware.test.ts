import { afterEach, describe, expect, it } from 'bun:test'
import {
  __resetRateLimitState,
  consumeRateLimit,
  consumeRateLimitDistributed,
  getRateLimitKey,
  getRateLimitPolicy,
} from '../../auth/rate-limit.middleware'

describe('rate limit middleware', () => {
  afterEach(() => __resetRateLimitState())

  it('limits requests per actor/tenant/path window', () => {
    const key = getRateLimitKey('/api/admin/commands', 'POST', 'u1', 'tenant-a')

    const first = consumeRateLimit(key, 1000, 10_000, 2)
    const second = consumeRateLimit(key, 1001, 10_000, 2)
    const third = consumeRateLimit(key, 1002, 10_000, 2)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third.allowed).toBe(false)
  })

  it('normalizes dynamic admin paths into one bucket key', () => {
    const keyA = getRateLimitKey('/api/admin/entries/entry-a', 'GET', 'u1', 'tenant-a')
    const keyB = getRateLimitKey('/api/admin/entries/entry-b', 'GET', 'u1', 'tenant-a')

    expect(keyA).toBe(keyB)
  })

  it('uses per-ip anonymous buckets when actor is missing', () => {
    const keyA = getRateLimitKey('/api/health', 'GET', undefined, undefined, '203.0.113.1')
    const keyB = getRateLimitKey('/api/health', 'GET', undefined, undefined, '203.0.113.2')

    expect(keyA).not.toBe(keyB)
  })

  it('uses tighter policy for auth-sensitive endpoints', () => {
    expect(getRateLimitPolicy('/api/auth/sign-in/email', 'POST')).toEqual({
      windowMs: 60_000,
      limit: 30,
    })
    expect(getRateLimitPolicy('/api/csrf', 'GET')).toEqual({ windowMs: 60_000, limit: 30 })
  })

  it('uses route-specific policies for expensive and public surfaces', () => {
    expect(getRateLimitPolicy('/api/admin/ai/command', 'POST')).toEqual({
      windowMs: 60_000,
      limit: 20,
    })
    expect(getRateLimitPolicy('/api/admin/entries', 'POST')).toEqual({ windowMs: 60_000, limit: 60 })
    expect(getRateLimitPolicy('/api/public/articles', 'GET')).toEqual({
      windowMs: 60_000,
      limit: 300,
    })
    expect(getRateLimitPolicy('/api/health', 'GET')).toEqual({ windowMs: 60_000, limit: 120 })
  })

  it('uses KV-backed buckets across requests when KV is available', async () => {
    const state = new Map<string, string>()
    const kv = {
      get: async (key: string) => state.get(key) ?? null,
      put: async (key: string, value: string) => {
        state.set(key, value)
      },
    } as unknown as KVNamespace

    const key = getRateLimitKey('/api/admin/commands', 'POST', 'u1', 'tenant-a')
    const first = await consumeRateLimitDistributed(key, { kv, now: 1000, windowMs: 10_000, limit: 2 })
    const second = await consumeRateLimitDistributed(key, { kv, now: 1001, windowMs: 10_000, limit: 2 })
    const third = await consumeRateLimitDistributed(key, { kv, now: 1002, windowMs: 10_000, limit: 2 })

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third.allowed).toBe(false)
  })
})
