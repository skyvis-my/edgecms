import { afterAll, describe, expect, it, mock, vi } from 'bun:test'

// Create proper mock bindings that will pass health probes
const createMockDB = () => ({
  prepare: vi.fn().mockReturnValue({
    first: vi.fn().mockResolvedValue({ ok: 1 }),
  }),
})

const createMockKV = () => ({
  get: vi.fn().mockResolvedValue(null),
})

const createMockR2 = () => ({
  head: vi.fn().mockResolvedValue(null),
})

const createMockScheduler = () => ({
  idFromName: vi.fn(),
})

const createMockQueue = () => ({
  send: vi.fn(),
})

const mockWorkerEnv: Record<string, unknown> = {
  DB: createMockDB(),
  CACHE: createMockKV(),
  MEDIA: createMockR2(),
  ASSETS: createMockR2(),
  PUBLISH_SCHEDULER: createMockScheduler(),
  WEBHOOK_QUEUE: createMockQueue(),
}

mock.module('cloudflare:workers', () => ({
  env: mockWorkerEnv,
}))

const { buildHealthStatus } = await import(`../health?bypass=${Date.now()}`)

afterAll(() => {
  mock.restore()
})

describe('buildHealthStatus', () => {
  describe('when all bindings are present', () => {
    it('returns status ok', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.status).toBe('ok')
    })

    it('reports all subsystems as ok', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.subsystems.database.status).toBe('ok')
      expect(health.subsystems.cache.status).toBe('ok')
      expect(health.subsystems.media.status).toBe('ok')
      expect(health.subsystems.assets.status).toBe('ok')
      expect(health.subsystems.scheduler.status).toBe('ok')
      expect(health.subsystems.webhooks.status).toBe('ok')
    })

    it('includes a valid ISO 8601 timestamp', async () => {
      const health = await buildHealthStatus()
      expect(health.timestamp).toBeDefined()
      expect(typeof health.timestamp).toBe('string')
      const parsed = Date.parse(health.timestamp)
      expect(Number.isNaN(parsed)).toBe(false)
    })

    it('returns a timestamp close to current time', async () => {
      const before = Date.now()
      const health = await buildHealthStatus()
      const after = Date.now()
      const ts = Date.parse(health.timestamp)
      expect(ts).toBeGreaterThanOrEqual(before)
      expect(ts).toBeLessThanOrEqual(after)
    })
  })

  describe('when some bindings are missing', () => {
    it('returns status degraded when DB is missing', async () => {
      mockWorkerEnv.DB = undefined
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.status).toBe('degraded')
      expect(health.subsystems.database.status).toBe('missing')
    })

    it('returns status degraded when CACHE is missing', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = undefined
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.status).toBe('degraded')
      expect(health.subsystems.cache.status).toBe('missing')
    })

    it('returns status degraded when MEDIA is missing', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = undefined
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.status).toBe('degraded')
      expect(health.subsystems.media.status).toBe('missing')
    })

    it('returns status degraded when ASSETS is missing', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = undefined
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.status).toBe('degraded')
      expect(health.subsystems.assets.status).toBe('missing')
    })

    it('returns status degraded when PUBLISH_SCHEDULER is missing', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = undefined
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.status).toBe('degraded')
      expect(health.subsystems.scheduler.status).toBe('missing')
    })

    it('returns status degraded when WEBHOOK_QUEUE is missing', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = undefined

      const health = await buildHealthStatus()
      expect(health.status).toBe('degraded')
      expect(health.subsystems.webhooks.status).toBe('missing')
    })

    it('reports degraded when multiple bindings are missing', async () => {
      mockWorkerEnv.DB = undefined
      mockWorkerEnv.CACHE = undefined
      mockWorkerEnv.MEDIA = undefined
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.status).toBe('degraded')
      expect(health.subsystems.database.status).toBe('missing')
      expect(health.subsystems.cache.status).toBe('missing')
      expect(health.subsystems.media.status).toBe('missing')
      expect(health.subsystems.assets.status).toBe('ok')
    })

    it('reports degraded when all bindings are missing', async () => {
      mockWorkerEnv.DB = undefined
      mockWorkerEnv.CACHE = undefined
      mockWorkerEnv.MEDIA = undefined
      mockWorkerEnv.ASSETS = undefined
      mockWorkerEnv.PUBLISH_SCHEDULER = undefined
      mockWorkerEnv.WEBHOOK_QUEUE = undefined

      const health = await buildHealthStatus()
      expect(health.status).toBe('degraded')
      expect(health.subsystems.database.status).toBe('missing')
      expect(health.subsystems.cache.status).toBe('missing')
      expect(health.subsystems.media.status).toBe('missing')
      expect(health.subsystems.assets.status).toBe('missing')
      expect(health.subsystems.scheduler.status).toBe('missing')
      expect(health.subsystems.webhooks.status).toBe('missing')
    })
  })

  describe('binding status detection', () => {
    it('treats null as missing', async () => {
      mockWorkerEnv.DB = null
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.subsystems.database.status).toBe('missing')
    })

    it('treats false as missing', async () => {
      mockWorkerEnv.DB = false
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.subsystems.database.status).toBe('missing')
    })

    it('treats empty string as missing', async () => {
      mockWorkerEnv.DB = ''
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.subsystems.database.status).toBe('missing')
    })

    it('treats zero as missing', async () => {
      mockWorkerEnv.DB = 0
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.subsystems.database.status).toBe('missing')
    })

    it('treats a truthy object as ok', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      expect(health.status).toBe('ok')
    })
  })

  describe('response structure', () => {
    it('has exactly four top-level keys: status, timestamp, subsystems, version', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      const keys = Object.keys(health).sort()
      expect(keys).toEqual(['status', 'subsystems', 'timestamp', 'version'])
    })

    it('has exactly six subsystem keys', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      const subsystemKeys = Object.keys(health.subsystems).sort()
      expect(subsystemKeys).toEqual([
        'assets',
        'cache',
        'database',
        'media',
        'scheduler',
        'webhooks',
      ])
    })

    it('status is always either ok, degraded, or unhealthy', async () => {
      // All present
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()
      expect(['ok', 'degraded', 'unhealthy']).toContain((await buildHealthStatus()).status)

      // One missing
      mockWorkerEnv.DB = undefined
      expect(['ok', 'degraded', 'unhealthy']).toContain((await buildHealthStatus()).status)
    })

    it('each subsystem value has status key', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = undefined
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = undefined
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      for (const value of Object.values(health.subsystems) as { status: string }[]) {
        expect(value.status).toBeDefined()
      }
    })

    it('timestamp is in ISO 8601 format', async () => {
      mockWorkerEnv.DB = createMockDB()
      mockWorkerEnv.CACHE = createMockKV()
      mockWorkerEnv.MEDIA = createMockR2()
      mockWorkerEnv.ASSETS = createMockR2()
      mockWorkerEnv.PUBLISH_SCHEDULER = createMockScheduler()
      mockWorkerEnv.WEBHOOK_QUEUE = createMockQueue()

      const health = await buildHealthStatus()
      // ISO 8601 pattern: YYYY-MM-DDTHH:MM:SS.sssZ
      expect(health.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
      )
    })
  })

  describe('active probes with latency', () => {
    it('includes latency measurements for database probe', async () => {
      const mockDb = createMockDB()
      const { buildHealthStatus } = await import(`../health?bypass=${Date.now() + 1}`)
      const status = await buildHealthStatus({ db: mockDb as unknown as D1Database })
      expect(status.subsystems.database).toEqual(
        expect.objectContaining({
          status: 'ok',
          latencyMs: expect.any(Number),
        })
      )
    })

    it('returns error when DB probe fails', async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          first: vi.fn().mockRejectedValue(new Error('DB down')),
        }),
      }
      const { buildHealthStatus } = await import(`../health?bypass=${Date.now() + 2}`)
      const status = await buildHealthStatus({ db: mockDb as unknown as D1Database })
      expect(status.subsystems.database.status).toBe('error')
    })
  })
})
