import { describe, expect, it } from 'bun:test'
import { createRedisKv, type RedisLike } from '@/hosting/bindings/redis-kv'

function mockRedis(): RedisLike & { store: Map<string, { value: string; expiresAt?: number }> } {
  const store = new Map<string, { value: string; expiresAt?: number }>()

  const client: RedisLike & { store: typeof store } = {
    store,
    async get(key) {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
        store.delete(key)
        return null
      }
      return entry.value
    },
    async set(key, value, ...args) {
      let expiresAt: number | undefined
      if (args[0] === 'EX' && args[1]) {
        expiresAt = Date.now() + Number(args[1]) * 1000
      }
      store.set(key, { value, expiresAt })
    },
    async del(...keys) {
      for (const key of keys) store.delete(key)
    },
    async scan(cursor, ...args) {
      const matchIdx = args.indexOf('MATCH')
      const pattern = (matchIdx >= 0 ? args[matchIdx + 1] : undefined) ?? '*'
      const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix))
      if (cursor !== '0') return ['0', []]
      return ['0', keys]
    },
  }
  return client
}

describe('createRedisKv', () => {
  it('puts and gets string values', async () => {
    const client = mockRedis()
    const kv = createRedisKv(client)
    await kv.put('a', '1')
    expect(await kv.get('a')).toBe('1')
  })

  it('parses json get type', async () => {
    const client = mockRedis()
    const kv = createRedisKv(client)
    await kv.put('j', JSON.stringify({ ok: true }))
    expect(await kv.get('j', 'json')).toEqual({ ok: true })
  })

  it('respects expirationTtl via Redis EX', async () => {
    const client = mockRedis()
    const kv = createRedisKv(client)
    await kv.put('ttl', 'x', { expirationTtl: 60 })
    expect(client.store.get('ttl')?.expiresAt).toBeGreaterThan(Date.now())
    expect(await kv.get('ttl')).toBe('x')
  })

  it('deletes keys whose absolute expiration is already past', async () => {
    const client = mockRedis()
    const kv = createRedisKv(client)
    await kv.put('gone', 'y', { expiration: Math.floor(Date.now() / 1000) - 5 })
    expect(await kv.get('gone')).toBeNull()
    expect(client.store.has('gone')).toBe(false)
  })

  it('lists by prefix', async () => {
    const client = mockRedis()
    const kv = createRedisKv(client)
    await kv.put('snap:a', '1')
    await kv.put('snap:b', '2')
    await kv.put('other', '3')
    const listed = await kv.list({ prefix: 'snap:' })
    expect(listed.keys.map((k) => k.name).sort()).toEqual(['snap:a', 'snap:b'])
  })

  it('deletes keys', async () => {
    const client = mockRedis()
    const kv = createRedisKv(client)
    await kv.put('z', '1')
    await kv.delete('z')
    expect(await kv.get('z')).toBeNull()
  })
})
