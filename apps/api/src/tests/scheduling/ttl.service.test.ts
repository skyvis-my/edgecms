import { describe, expect, it, vi } from 'bun:test'
import type { Database } from '@/database/db'

const { computeDynamicTTL } = await import(`../../scheduling/ttl.service?bypass=${Date.now()}`)

describe('TTL Service', () => {
  const testCollectionId = 'test-collection-id'

  it('returns default TTL when no pending transitions exist', async () => {
    // Mock empty result (no entries)
    const mockDb = createChainableDb([])
    const ttl = await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 1800)
    expect(ttl).toBe(1800)
  })

  it('returns maximum TTL of 3600 when default exceeds max', async () => {
    // No entries, but default is very high
    const mockDb = createChainableDb([])
    const ttl = await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 7200)
    expect(ttl).toBe(3600)
  })

  it('returns minimum TTL of 60 seconds when transition is imminent', async () => {
    // Create entry with publish_at in 30 seconds (below minimum)
    const now = new Date()
    const publishAt = new Date(now.getTime() + 30 * 1000).toISOString()

    const mockDb = createChainableDb([{ publishAt, unpublishAt: null }])
    const ttl = await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 1800)
    expect(ttl).toBe(60) // Capped at minimum
  })

  it('returns computed TTL when transition is within default TTL window', async () => {
    // Create entry with publish_at in 300 seconds (5 minutes)
    const now = new Date()
    const publishAt = new Date(now.getTime() + 300 * 1000).toISOString()

    const mockDb = createChainableDb([{ publishAt, unpublishAt: null }])
    const ttl = await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 1800)
    // Should return ~300 seconds (with small tolerance for test execution time)
    expect(ttl).toBeGreaterThanOrEqual(290)
    expect(ttl).toBeLessThanOrEqual(305)
  })

  it('returns default TTL when transition is beyond default TTL window', async () => {
    // Create entry with publish_at in 2 hours (7200 seconds)
    const now = new Date()
    const publishAt = new Date(now.getTime() + 7200 * 1000).toISOString()

    const mockDb = createChainableDb([{ publishAt, unpublishAt: null }])
    const ttl = await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 1800)
    expect(ttl).toBe(1800) // Returns default, capped by max 3600
  })

  it('selects nearest transition when multiple pending transitions exist', async () => {
    // Create entries with different transition times
    const now = new Date()
    const publishAt1 = new Date(now.getTime() + 600 * 1000).toISOString() // 10 minutes
    const publishAt2 = new Date(now.getTime() + 180 * 1000).toISOString() // 3 minutes (nearest)
    const unpublishAt = new Date(now.getTime() + 1200 * 1000).toISOString() // 20 minutes

    const mockDb = createChainableDb([
      { publishAt: publishAt1, unpublishAt: null },
      { publishAt: publishAt2, unpublishAt: null },
      { publishAt: null, unpublishAt },
    ])
    const ttl = await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 1800)
    // Should return ~180 seconds (nearest transition)
    expect(ttl).toBeGreaterThanOrEqual(170)
    expect(ttl).toBeLessThanOrEqual(185)
  })

  it('considers both publish_at and unpublish_at transitions', async () => {
    // Create entry with unpublish_at sooner than publish_at
    const now = new Date()
    const publishAt = new Date(now.getTime() + 600 * 1000).toISOString() // 10 minutes
    const unpublishAt = new Date(now.getTime() + 120 * 1000).toISOString() // 2 minutes (nearest)

    const mockDb = createChainableDb([{ publishAt, unpublishAt }])
    const ttl = await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 1800)
    // Should return ~120 seconds (unpublish_at is nearest)
    expect(ttl).toBeGreaterThanOrEqual(110)
    expect(ttl).toBeLessThanOrEqual(125)
  })

  it('ignores past transitions', async () => {
    // Create entry with past publish_at and future unpublish_at
    const now = new Date()
    const publishAt = new Date(now.getTime() - 3600 * 1000).toISOString() // 1 hour ago
    const unpublishAt = new Date(now.getTime() + 240 * 1000).toISOString() // 4 minutes from now

    const mockDb = createChainableDb([{ publishAt, unpublishAt }])
    const ttl = await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 1800)
    // Should return ~240 seconds (only future unpublish_at is considered)
    expect(ttl).toBeGreaterThanOrEqual(230)
    expect(ttl).toBeLessThanOrEqual(245)
  })

  it('handles entries with only publish_at', async () => {
    // Create entry with only publish_at
    const now = new Date()
    const publishAt = new Date(now.getTime() + 450 * 1000).toISOString() // 7.5 minutes

    const mockDb = createChainableDb([{ publishAt, unpublishAt: null }])
    const ttl = await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 1800)
    expect(ttl).toBeGreaterThanOrEqual(440)
    expect(ttl).toBeLessThanOrEqual(455)
  })

  it('handles entries with only unpublish_at', async () => {
    // Create entry with only unpublish_at
    const now = new Date()
    const unpublishAt = new Date(now.getTime() + 360 * 1000).toISOString() // 6 minutes

    const mockDb = createChainableDb([{ publishAt: null, unpublishAt }])
    const ttl = await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 1800)
    expect(ttl).toBeGreaterThanOrEqual(350)
    expect(ttl).toBeLessThanOrEqual(365)
  })

  it('caps TTL at maximum of 3600 even when transition is far in future', async () => {
    // Create entry with publish_at in 10 hours
    const now = new Date()
    const publishAt = new Date(now.getTime() + 10 * 3600 * 1000).toISOString()

    const mockDb = createChainableDb([{ publishAt, unpublishAt: null }])
    const ttl = await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 5000)
    expect(ttl).toBe(3600) // Capped at maximum
  })

  it('does not couple transition scan to entry status in SQL predicate', async () => {
    const whereCalls: unknown[] = []
    const mockDb = createChainableDb([], whereCalls)
    await computeDynamicTTL(mockDb as unknown as Database, testCollectionId, 1800)

    expect(containsLiteral(whereCalls[0], 'scheduled')).toBe(false)
  })
})

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a mock Drizzle-like DB that returns a specific set of entries.
 * This mock supports the query pattern used in computeDynamicTTL:
 *   db.select({ publishAt, unpublishAt }).from(entries).where(...) -> Promise<rows>
 */
function createChainableDb(
  entries: Array<{ publishAt: string | null; unpublishAt: string | null }>,
  whereCalls: unknown[] = []
) {
  const selectChainBase = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn((arg: unknown) => {
      whereCalls.push(arg)
      return selectChain
    }),
  }
  const selectChain = Object.assign(Promise.resolve(entries), selectChainBase)

  return {
    select: vi.fn().mockReturnValue(selectChain),
  }
}

function containsLiteral(value: unknown, literal: string, visited = new Set<unknown>()): boolean {
  if (value === literal) {
    return true
  }
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return false
  }
  if (visited.has(value)) {
    return false
  }
  visited.add(value)

  for (const child of Object.values(value as Record<string, unknown>)) {
    if (containsLiteral(child, literal, visited)) {
      return true
    }
  }

  return false
}
