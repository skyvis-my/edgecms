import { beforeEach, describe, expect, it, mock, vi } from 'bun:test'

const mockCountAll = vi.fn()
const mockWorkerEnv = {
  DB: {} as D1Database,
  CACHE: {} as KVNamespace,
  MEDIA: {} as R2Bucket,
  ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
  PUBLISH_SCHEDULER: {} as DurableObjectNamespace,
  WEBHOOK_QUEUE: {} as Queue,
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters',
}

mock.module('cloudflare:workers', () => ({ env: mockWorkerEnv }))
mock.module('@/users/users.repository', () => ({
  usersRepository: {
    countAll: mockCountAll,
  },
}))

async function importApp() {
  const mod = await import(`@/main?bootstrap-status=${Date.now()}`)
  return mod.default as { handle: (request: Request) => Promise<Response> }
}

describe('GET /api/bootstrap/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns onboarding required when no users exist', async () => {
    mockCountAll.mockResolvedValue(0)
    const app = await importApp()

    const response = await app.handle(new Request('http://localhost/api/bootstrap/status'))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toEqual({ needsOnboarding: true, userCount: 0 })
  })

  it('returns onboarding not required when users exist', async () => {
    mockCountAll.mockResolvedValue(3)
    const app = await importApp()

    const response = await app.handle(new Request('http://localhost/api/bootstrap/status'))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toEqual({ needsOnboarding: false, userCount: 3 })
  })

  it('fails safe to onboarding required on repository error', async () => {
    mockCountAll.mockRejectedValue(new Error('db failed'))
    const app = await importApp()

    const response = await app.handle(new Request('http://localhost/api/bootstrap/status'))
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toEqual({ needsOnboarding: true, userCount: 0 })
  })
})
