import { describe, expect, it } from 'bun:test'
import { createMemoryKv } from '@/hosting/bindings/memory-kv'

describe('createMemoryKv', () => {
  it('puts and gets string values', async () => {
    const kv = createMemoryKv()
    await kv.put('a', '1')
    expect(await kv.get('a')).toBe('1')
  })

  it('respects expirationTtl', async () => {
    const kv = createMemoryKv()
    await kv.put('ttl', 'x', { expirationTtl: 1 })
    expect(await kv.get('ttl')).toBe('x')
    // Force expiry by writing a past expiration via put with expiration epoch
    await kv.put('gone', 'y', { expiration: Math.floor(Date.now() / 1000) - 5 })
    expect(await kv.get('gone')).toBeNull()
  })

  it('lists by prefix', async () => {
    const kv = createMemoryKv()
    await kv.put('snap:a', '1')
    await kv.put('snap:b', '2')
    await kv.put('other', '3')
    const listed = await kv.list({ prefix: 'snap:' })
    expect(listed.keys.map((k) => k.name).sort()).toEqual(['snap:a', 'snap:b'])
  })
})
