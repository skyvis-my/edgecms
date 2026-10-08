import { env } from 'cloudflare:workers'
import { Elysia } from 'elysia'
import { createDb } from '@/database/db'
import type { Env } from '@/env'
import { systemService } from './system.service'

export const systemController = new Elysia({ prefix: '/api/admin/system' }).get(
  '/stats',
  async () => {
    const workerEnv = env as unknown as Env
    const db = createDb(workerEnv.DB)
    return systemService.getStats(db)
  }
)
