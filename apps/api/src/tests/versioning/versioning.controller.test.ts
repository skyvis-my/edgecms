import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { Elysia } from 'elysia'

const mockVersioningService = {
  listVersions: vi.fn(),
  getVersion: vi.fn(),
  diffVersions: vi.fn(),
  rollback: vi.fn(),
}

vi.mock('cloudflare:workers', () => ({
  env: {
    DB: {} as D1Database,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
  },
}))

vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia().macro({
    auth: {
      resolve() {
        return { user: { id: 'user-1' } }
      },
    },
  }),
}))

vi.mock('../../versioning/versioning.service', () => ({
  versioningService: mockVersioningService,
}))

const { versioningController } = await import(
  `../../versioning/versioning.controller?bypass=${Date.now()}`
)

describe('versioningController', () => {
  const app = new Elysia().use(versioningController)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns entry version list + diff', async () => {
    mockVersioningService.listVersions.mockResolvedValue({
      success: true,
      data: {
        versions: [{ id: 'v2' }, { id: 'v1' }],
        total: 2,
        page: 1,
        perPage: 20,
        latestDiff: [{ field: 'title', before: 'Old', after: 'New', action: 'update' }],
      },
    })

    const response = await app.handle(new Request('http://localhost/api/admin/entries/e1/versions'))
    const body = (await response.json()) as {
      success: boolean
      data: {
        versions: unknown[]
        latestDiff: unknown[]
      }
    }

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.versions.length).toBeGreaterThan(0)
    expect(Array.isArray(body.data.latestDiff)).toBe(true)
  })

  it('rolls back an entry version', async () => {
    mockVersioningService.rollback.mockResolvedValue({
      success: true,
      data: {
        entry: { id: 'e1', version: 3 },
        newVersion: { id: 'v3', version: 3 },
      },
    })

    const response = await app.handle(
      new Request('http://localhost/api/admin/entries/e1/versions/v2/rollback', {
        method: 'POST',
      })
    )
    const body = (await response.json()) as {
      success: boolean
      data: {
        newVersion: { version: number }
      }
    }

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.newVersion.version).toBe(3)
  })
})
