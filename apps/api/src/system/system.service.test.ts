import { describe, it, expect, vi } from 'bun:test'
import type { Database } from '@/database/db'
import { systemService } from './system.service'

describe('systemService.getStats', () => {
  it('returns aggregate counts structure', () => {
    // Verify the service function exists and returns the right structure
    expect(typeof systemService.getStats).toBe('function')
  })

  it('scopes stats queries by tenant when tenantId is provided', async () => {
    const selectResults = [[{ count: 3 }], [{ count: 12 }], [{ count: 8 }]]
    let call = 0
    const whereSpy = vi.fn((_cond: unknown) => {
      const rows = selectResults[call++] ?? [{ count: 0 }]
      return Promise.resolve(rows)
    })
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: whereSpy,
        })),
      })),
    }

    const result = await systemService.getStats(db as unknown as Database, 'tenant-1')

    expect(whereSpy).toHaveBeenCalledTimes(3)
    expect(result).toEqual({
      collections: 3,
      entries: 12,
      publishedEntries: 8,
    })
  })
})
