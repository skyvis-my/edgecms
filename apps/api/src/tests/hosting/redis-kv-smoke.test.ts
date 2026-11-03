/**
 * Optional live Redis smoke. Skips unless REDIS_SMOKE_URL (or REDIS_URL) is set
 * and the optional `redis` package is installed.
 *
 *   REDIS_SMOKE_URL=redis://127.0.0.1:6379 bun test apps/api/src/tests/hosting/redis-kv-smoke.test.ts
 */
import { describe, expect, it } from 'bun:test'
import { connectRedisUrl, createRedisKv } from '@/hosting/bindings/redis-kv'

const smokeUrl = process.env.REDIS_SMOKE_URL?.trim() || process.env.REDIS_URL?.trim()

describe('redis-kv live smoke', () => {
  it('round-trips through a real Redis when REDIS_SMOKE_URL is set', async () => {
    if (!smokeUrl) {
      console.log('skip: set REDIS_SMOKE_URL to run live Redis smoke')
      return
    }

    let client: Awaited<ReturnType<typeof connectRedisUrl>>
    try {
      client = await connectRedisUrl(smokeUrl)
    } catch (err) {
      console.log(`skip: could not connect to Redis at ${smokeUrl}: ${String(err)}`)
      return
    }

    try {
      const kv = createRedisKv(client)
      const key = `edgecms:smoke:${Date.now()}:${Math.random().toString(36).slice(2)}`
      await kv.put(key, JSON.stringify({ ok: true }), { expirationTtl: 30 })
      expect(await kv.get(key, 'json')).toEqual({ ok: true })
      await kv.delete(key)
      expect(await kv.get(key)).toBeNull()
    } finally {
      client.close()
    }
  })
})
