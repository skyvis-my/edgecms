import { describe, expect, it, vi, mock } from 'bun:test'
import { Elysia } from 'elysia'

const mockWithSession = vi.fn()
const mockEnv = {
  DB: {
    name: 'root-d1',
    withSession: mockWithSession,
  },
  CACHE: {},
  MEDIA: {},
}

mock.module('cloudflare:workers', () => ({
  env: mockEnv,
}))

const { setCorsHeaders, CORS_EXPOSED_HEADERS } = await import('../../auth/cors')
const { withTenantBindings } = await import('../../tenants/with-tenant-bindings')
const { buildPublicCacheTag } = await import('../../public/public.service')
const { extractCacheTagsFromCommand } = await import('../../cache/invalidation.service')
import type { Database } from '@/database/db'

describe('D1 Session Bookmark Propagation & Dual-Indexed Cache Tags', () => {
  describe('CORS Access-Control-Expose-Headers', () => {
    it('defines CORS_EXPOSED_HEADERS containing x-d1-session', () => {
      expect(CORS_EXPOSED_HEADERS).toContain('x-d1-session')
    })

    it('sets Access-Control-Expose-Headers with x-d1-session', () => {
      const headers: Record<string, string | number> = {}
      setCorsHeaders(headers, 'http://localhost:5173')
      expect(headers['Access-Control-Expose-Headers']).toBe('x-d1-session')
    })
  })

  describe('D1 Session Bookmark Propagation', () => {
    it('invokes withSession when x-d1-session header is present', async () => {
      const sessionBookmark = 'bm_abc123'
      const mockSessionDb = {
        name: 'session-d1',
        getBookmark: vi.fn().mockReturnValue(sessionBookmark),
      }
      mockWithSession.mockReturnValueOnce(mockSessionDb)

      const testApp = new Elysia()
        .derive(() => ({
          tenant: {
            tenant: { id: 'tenant-1', slug: 'acme', name: 'Acme', status: 'active' },
            resources: { mode: 'shared' as const },
          },
        }))
        .use(withTenantBindings)
        .get('/test-session', ({ workerEnv }) => {
          return { dbName: (workerEnv.DB as unknown as { name: string }).name }
        })

      const res = await testApp.handle(
        new Request('http://localhost/test-session', {
          headers: {
            'x-d1-session': sessionBookmark,
          },
        })
      )

      expect(res.status).toBe(200)
      expect(mockWithSession).toHaveBeenCalledWith(sessionBookmark)
      const json = (await res.json()) as { dbName: string }
      expect(json.dbName).toBe('session-d1')
    })

    it('emits x-d1-session header from db bookmark in afterHandle hook', async () => {
      const expectedBookmark = 'bm_write_success_xyz'
      const app = new Elysia()
        .onAfterHandle('global', (ctx) => {
          const db = (ctx as { db?: any }).db
          const bookmark =
            typeof db?.$client?.getBookmark === 'function'
              ? db.$client.getBookmark()
              : typeof (db as any)?.getBookmark === 'function'
                ? (db as any).getBookmark()
                : undefined
          if (bookmark && typeof bookmark === 'string') {
            ;(ctx.set.headers as Record<string, string>)['x-d1-session'] = bookmark
            const res = (ctx as { response?: unknown }).response
            if (res instanceof Response) {
              try {
                res.headers.set('x-d1-session', bookmark)
              } catch {}
            }
          }
        })
        .derive(() => ({
          db: {
            $client: {
              getBookmark: () => expectedBookmark,
            },
          },
        }))
        .post('/mutation', () => ({ ok: true }))

      const res = await app.handle(
        new Request('http://localhost/mutation', {
          method: 'POST',
        })
      )

      expect(res.status).toBe(200)
      expect(res.headers.get('x-d1-session')).toBe(expectedBookmark)
    })

    it('does not emit x-d1-session header when getBookmark returns null or is not available', async () => {
      const app = new Elysia()
        .onAfterHandle('global', (ctx) => {
          const db = (ctx as { db?: any }).db
          const bookmark =
            typeof db?.$client?.getBookmark === 'function'
              ? db.$client.getBookmark()
              : typeof (db as any)?.getBookmark === 'function'
                ? (db as any).getBookmark()
                : undefined
          if (bookmark && typeof bookmark === 'string') {
            ;(ctx.set.headers as Record<string, string>)['x-d1-session'] = bookmark
          }
        })
        .derive(() => ({
          db: {
            $client: {
              getBookmark: () => null,
            },
          },
        }))
        .get('/read', () => ({ ok: true }))

      const res = await app.handle(new Request('http://localhost/read'))

      expect(res.status).toBe(200)
      expect(res.headers.get('x-d1-session')).toBeNull()
    })
  })

  describe('Dual-Indexed Cache Tagging', () => {
    it('buildPublicCacheTag generates dual tags with tenant prefix', () => {
      const tag = buildPublicCacheTag(
        { id: 'c123', slug: 'articles' },
        'en',
        'tenant-456'
      )

      expect(tag).toContain('t:tenant-456:c:c123')
      expect(tag).toContain('t:tenant-456:c:articles')
      expect(tag).toContain('collection:articles')
      expect(tag).toContain('locale:en')
    })

    it('buildPublicCacheTag generates dual tags with entry identifier when provided', () => {
      const tag = buildPublicCacheTag(
        { id: 'c123', slug: 'articles' },
        'en',
        'tenant-456',
        'hello-world'
      )

      expect(tag).toContain('t:tenant-456:c:c123')
      expect(tag).toContain('t:tenant-456:c:articles')
      expect(tag).toContain('entry:hello-world')
    })

    it('buildPublicCacheTag falls back to non-tenant tags when tenantId is not provided', () => {
      const tag = buildPublicCacheTag({ id: 'c123', slug: 'articles' }, 'en')

      expect(tag).not.toContain('t:')
      expect(tag).toBe('collection:articles,locale:en')
    })
  })

  describe('Dual-Indexed Purge Tag Construction on Mutations', () => {
    it('extracts both collection ID and collection slug tags for tenant mutations', async () => {
      const fakeDb = {
        select: vi.fn(),
      } as unknown as Database

      const tags = await extractCacheTagsFromCommand(
        fakeDb,
        'publishNow',
        { collectionId: 'c1', collectionSlug: 'posts', entryId: 'e100' },
        'tenant-x'
      )

      expect(tags).toContain('t:tenant-x:c:c1')
      expect(tags).toContain('t:tenant-x:c:posts')
      expect(tags).toContain('collection:c1')
      expect(tags).toContain('collection:posts')
      expect(tags).toContain('entry:e100')
    })

    it('extracts dual-indexed tags on bulkUpdate for tenant', async () => {
      const fakeDb = {
        select: vi.fn(),
      } as unknown as Database

      const tags = await extractCacheTagsFromCommand(
        fakeDb,
        'bulkUpdate',
        { collectionId: 'c1', collectionSlug: 'products', entryIds: ['p1', 'p2'] },
        'tenant-y'
      )

      expect(tags).toContain('t:tenant-y:c:c1')
      expect(tags).toContain('t:tenant-y:c:products')
      expect(tags).toContain('collection:c1')
      expect(tags).toContain('collection:products')
      expect(tags).toContain('entry:p1')
      expect(tags).toContain('entry:p2')
    })

    it('extracts dual-indexed tags on updateSingleton for tenant', async () => {
      const fakeDb = {
        select: vi.fn(),
      } as unknown as Database

      const tags = await extractCacheTagsFromCommand(
        fakeDb,
        'updateSingleton',
        { collectionId: 'c1', collectionSlug: 'site-config' },
        'tenant-z'
      )

      expect(tags).toContain('t:tenant-z:c:c1')
      expect(tags).toContain('t:tenant-z:c:site-config')
      expect(tags).toContain('collection:c1')
      expect(tags).toContain('collection:site-config')
    })
  })
})
