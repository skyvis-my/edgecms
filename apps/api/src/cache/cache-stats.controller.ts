import { Elysia } from 'elysia'
import { kvService } from '@/cache/kv.service'

export const cacheStatsController = new Elysia({ prefix: '/api/admin/cache' }).get(
  '/stats',
  () => {
    const stats = kvService.getMemoryCacheStats()
    return {
      memory: {
        entries: stats.entryCount,
        sizeBytes: stats.sizeBytes,
        maxSizeBytes: stats.maxSizeBytes,
        utilizationPercent: Math.round((stats.sizeBytes / stats.maxSizeBytes) * 100),
      },
    }
  }
)
