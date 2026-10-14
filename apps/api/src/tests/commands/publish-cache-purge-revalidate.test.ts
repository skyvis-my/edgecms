import { describe, expect, it, vi, beforeEach } from 'bun:test'
import { Elysia } from 'elysia'

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
} as unknown as D1Database

const mockKv = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
} as unknown as KVNamespace

const mockExecuteCommand = vi.fn().mockImplementation(async (ctx, envelope) => {
  if (envelope.type === 'publishNow' || envelope.type === 'unpublishNow') {
    ctx.invalidatedCacheTags = ['collection:posts', `entry:${envelope.payload.entryId}`]
    return {
      commandId: 'cmd-123',
      type: envelope.type,
      status: 'success',
      data: {
        id: envelope.payload.entryId,
        status: envelope.type === 'publishNow' ? 'published' : 'draft',
        slug: 'first-post',
        collectionSlug: 'posts',
      },
      executedAt: new Date().toISOString(),
    }
  }
  return {
    commandId: 'cmd-123',
    type: envelope.type,
    status: 'success',
    executedAt: new Date().toISOString(),
  }
})

vi.mock('cloudflare:workers', () => ({
  env: {
    DB: mockDb,
    CACHE: mockKv,
    MEDIA: {} as R2Bucket,
    CF_API_TOKEN: 'cf-test-token',
    CLOUDFLARE_ZONE_ID: 'cf-zone-123',
  },
}))

vi.mock('@/auth/auth.middleware', () => ({
  betterAuthPlugin: new Elysia().macro({
    auth: {
      derive() {
        return { user: { id: 'admin-user-1' } }
      },
    },
  }),
}))

vi.mock('../../commands/engine', () => ({
  executeCommand: mockExecuteCommand,
}))

const { commandsController } = await import(
  `../../commands/commands.controller?bypass=${Date.now()}`
)

describe('Publish/Unpublish Cache Purge & Revalidation Integration', () => {
  const app = new Elysia().use(commandsController)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets Cache-Tag-Purge, X-Cache-Tag-Purge, and CF-Cache-Purge headers on publishNow mutation', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/admin/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'publishNow',
          payload: { entryId: 'post-100' },
          actor: { userId: 'admin-user-1', source: 'admin' },
          timestamp: new Date().toISOString(),
        }),
      })
    )

    expect(response.status).toBe(200)
    const purgeTag = response.headers.get('cache-tag-purge')
    const xPurgeTag = response.headers.get('x-cache-tag-purge')
    const cfPurgeTag = response.headers.get('cf-cache-purge')

    expect(purgeTag).toContain('collection:posts')
    expect(purgeTag).toContain('entry:post-100')
    expect(xPurgeTag).toBe(purgeTag)
    expect(cfPurgeTag).toBe(purgeTag)
  })

  it('sets Cache-Tag-Purge headers on unpublishNow mutation', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/admin/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'unpublishNow',
          payload: { entryId: 'post-100' },
          actor: { userId: 'admin-user-1', source: 'admin' },
          timestamp: new Date().toISOString(),
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-tag-purge')).toBe('collection:posts,entry:post-100')
    expect(response.headers.get('x-cache-tag-purge')).toBe('collection:posts,entry:post-100')
  })
})
