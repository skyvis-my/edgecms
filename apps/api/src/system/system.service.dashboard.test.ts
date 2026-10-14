import { describe, expect, it, vi, beforeEach } from 'bun:test'
import type { Database } from '@/database/db'

vi.mock('../webhooks/webhooks.repository', () => ({
  webhooksRepository: {
    countByTenant: vi.fn(),
    summarizeByTenant: vi.fn(),
  },
}))

vi.mock('../assets/assets.repository', () => ({
  assetsRepository: {
    summarizeUsage: vi.fn(),
  },
}))

const { systemService } = await import(`./system.service?bypass=${Date.now()}`)

import { webhooksRepository } from '../webhooks/webhooks.repository'
import { assetsRepository } from '../assets/assets.repository'

const mockWebhooksRepository = webhooksRepository as unknown as {
  countByTenant: ReturnType<typeof vi.fn>
  summarizeByTenant: ReturnType<typeof vi.fn>
}
const mockAssetsRepository = assetsRepository as unknown as {
  summarizeUsage: ReturnType<typeof vi.fn>
}

describe('systemService.getDashboardSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fans out stats, webhook status summary, and asset usage in parallel', async () => {
    mockWebhooksRepository.summarizeByTenant.mockResolvedValue({
      total: 3,
      enabled: 2,
      failed: 1,
      pending: 0,
      delivered: 2,
    })
    mockAssetsRepository.summarizeUsage.mockResolvedValue({
      tenantId: 't1',
      assetCount: 5,
      totalBytes: 1024,
    })
    // getStats is unmocked here: stub the db select chain it uses.
    const selectResults = [[{ count: 2 }], [{ count: 7 }], [{ count: 4 }]]
    let call = 0
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => {
          const rows = selectResults[call++] ?? [{ count: 0 }]
          return Object.assign(Promise.resolve(rows), {
            where: vi.fn(async () => rows),
          })
        }),
      })),
    }

    const result = await systemService.getDashboardSummary(db as unknown as Database, 't1')

    expect(mockWebhooksRepository.summarizeByTenant).toHaveBeenCalledWith(
      expect.anything(),
      't1'
    )
    expect(mockAssetsRepository.summarizeUsage).toHaveBeenCalledWith(expect.anything(), 't1')
    expect(result.webhooks).toEqual({
      total: 3,
      enabled: 2,
      failed: 1,
      pending: 0,
      delivered: 2,
    })
    expect(result.assets).toEqual({ tenantId: 't1', assetCount: 5, totalBytes: 1024 })
    expect(result.stats).toEqual({ collections: 2, entries: 7, publishedEntries: 4 })
  })
})
