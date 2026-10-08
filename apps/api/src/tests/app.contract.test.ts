import { describe, expect, it, vi } from 'bun:test'

vi.mock('cloudflare:workers', () => ({
  env: {
    DB: {} as D1Database,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    ASSETS: {
      fetch: vi.fn(),
    } as unknown as Fetcher,
    PUBLISH_SCHEDULER: {} as DurableObjectNamespace,
    WEBHOOK_QUEUE: {} as Queue,
    BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters',
  },
}))

vi.mock('@/auth/auth', () => ({
  createAuth: vi.fn(() => ({
    handler: vi.fn(() => new Response('Not Found', { status: 404 })),
    api: {
      getSession: vi.fn(async () => null),
    },
  })),
}))

async function importCreateApp() {
  const module = await import('../app')
  return module.createApp
}

describe('API contract export', () => {
  it('builds an app instance that serves /api/health', async () => {
    const createApp = await importCreateApp()
    const app = createApp()
    const response = await app.handle(new Request('http://localhost/api/health'))
    expect(response.status).toBe(200)
  })

  it('builds an app instance that serves /api root health', async () => {
    const createApp = await importCreateApp()
    const app = createApp()
    const response = await app.handle(new Request('http://localhost/api'))
    expect(response.status).toBe(200)
  })
})
