import { describe, expect, it } from 'bun:test'
import { createMemoryKv } from '@/hosting/bindings/memory-kv'
import { createTwoTierKv } from '@/hosting/bindings/two-tier-kv'

describe('createTwoTierKv', () => {
  it('read-through: L2 miss stays miss; L2 hit fills L1', async () => {
    const l1 = createMemoryKv()
    const l2 = createMemoryKv()
    const kv = createTwoTierKv(l1, l2, { l1DefaultTtlSeconds: 30, l1MaxTtlSeconds: 60 })

    expect(await kv.get('missing')).toBeNull()

    await l2.put('k', 'from-l2')
    expect(await kv.get('k')).toBe('from-l2')
    // L1 was filled — reading L1 directly proves the populate.
    expect(await l1.get('k')).toBe('from-l2')
  })

  it('L1 hit skips L2', async () => {
    const l1 = createMemoryKv()
    const l2 = createMemoryKv()
    await l1.put('hot', 'l1-value')
    await l2.put('hot', 'l2-stale')
    const kv = createTwoTierKv(l1, l2)
    expect(await kv.get('hot')).toBe('l1-value')
  })

  it('write-through puts both tiers', async () => {
    const l1 = createMemoryKv()
    const l2 = createMemoryKv()
    const kv = createTwoTierKv(l1, l2, { writeMode: 'write-through' })
    await kv.put('a', '1', { expirationTtl: 120 })
    expect(await l2.get('a')).toBe('1')
    expect(await l1.get('a')).toBe('1')
  })

  it('write-invalidate writes L2 and clears L1', async () => {
    const l1 = createMemoryKv()
    const l2 = createMemoryKv()
    await l1.put('a', 'old-l1')
    const kv = createTwoTierKv(l1, l2, { writeMode: 'write-invalidate' })
    await kv.put('a', 'new')
    expect(await l2.get('a')).toBe('new')
    expect(await l1.get('a')).toBeNull()
    // Next get read-through fills L1 from L2.
    expect(await kv.get('a')).toBe('new')
    expect(await l1.get('a')).toBe('new')
  })

  it('delete clears both tiers', async () => {
    const l1 = createMemoryKv()
    const l2 = createMemoryKv()
    const kv = createTwoTierKv(l1, l2)
    await kv.put('x', '1')
    await kv.delete('x')
    expect(await l1.get('x')).toBeNull()
    expect(await l2.get('x')).toBeNull()
    expect(await kv.get('x')).toBeNull()
  })

  it('list is authoritative from L2', async () => {
    const l1 = createMemoryKv()
    const l2 = createMemoryKv()
    await l1.put('snap:only-l1', '1')
    await l2.put('snap:shared', '2')
    await l2.put('other', '3')
    const kv = createTwoTierKv(l1, l2)
    const listed = await kv.list({ prefix: 'snap:' })
    expect(listed.keys.map((k) => k.name)).toEqual(['snap:shared'])
  })

  it('caps L1 TTL below L2 expirationTtl', async () => {
    const l1 = createMemoryKv()
    const l2 = createMemoryKv()
    const kv = createTwoTierKv(l1, l2, {
      l1DefaultTtlSeconds: 10,
      l1MaxTtlSeconds: 15,
      writeMode: 'write-through',
    })
    await kv.put('long', 'v', { expirationTtl: 3600 })
    expect(await l2.get('long')).toBe('v')
    expect(await l1.get('long')).toBe('v')
    // Force L1 expiry with a past expiration while L2 remains.
    await l1.put('long', 'v', { expiration: Math.floor(Date.now() / 1000) - 1 })
    expect(await l1.get('long')).toBeNull()
    expect(await kv.get('long')).toBe('v')
    expect(await l1.get('long')).toBe('v')
  })
})
