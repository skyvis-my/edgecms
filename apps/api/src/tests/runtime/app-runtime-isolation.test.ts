import { describe, expect, it, mock, vi } from 'bun:test'
import type { Env } from '@/env'

const mockWorkerEnv = {
  DB: {
    prepare: vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ success: true })),
    })),
  } as unknown as D1Database,
  CACHE: {
    get: vi.fn(async () => null),
    put: vi.fn(async () => {}),
  } as unknown as KVNamespace,
  MEDIA: {} as R2Bucket,
  ASSETS: { fetch: vi.fn() } as unknown as Fetcher,
  PUBLISH_SCHEDULER: {} as DurableObjectNamespace,
  WEBHOOK_QUEUE: {} as Queue,
  BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters',
}

mock.module('cloudflare:workers', () => ({
  env: mockWorkerEnv,
}))

mock.module('@/auth/auth', () => ({
  createAuth: vi.fn(() => ({
    handler: vi.fn(() => new Response('Not Found', { status: 404 })),
    api: {
      getSession: vi.fn(async () => ({
        user: { id: 'admin-1', role: 'admin' },
        session: { id: 'sess-1' },
      })),
    },
  })),
}))

const { createApp } = await import('@/app')
const { createPluginRuntime } = await import('@/plugins/plugin-loader')
const { bootstrapApp } = await import('@/runtime/bootstrap')

describe('F07 — Move bootstrap work behind the application boundary', () => {
  it('isolates metric sinks across distinct app instances', async () => {
    const metricsA: Array<{ name: string; labels: Record<string, string>; value: number }> = []
    const metricsB: Array<{ name: string; labels: Record<string, string>; value: number }> = []

    const sinkA = (name: string, labels: Record<string, string>, value: number) => {
      metricsA.push({ name, labels, value })
    }
    const sinkB = (name: string, labels: Record<string, string>, value: number) => {
      metricsB.push({ name, labels, value })
    }

    const appA = createApp({ metricSink: sinkA })
    const appB = createApp({ metricSink: sinkB })

    // Request to App A
    const resA = await appA.handle(new Request('http://localhost/api/health'))
    expect(resA.status).toBe(200)

    // Request to App B
    const resB = await appB.handle(new Request('http://localhost/api/health'))
    expect(resB.status).toBe(200)

    // Verify App A received http_requests_total
    const aReqs = metricsA.filter((m) => m.name === 'http_requests_total')
    expect(aReqs.length).toBeGreaterThan(0)

    // Verify App B received http_requests_total
    const bReqs = metricsB.filter((m) => m.name === 'http_requests_total')
    expect(bReqs.length).toBeGreaterThan(0)

    // Verify App B's sink invocation did not replace or leak into App A's recorded events
    expect(metricsA.every((m) => m.name === 'http_requests_total')).toBe(true)
    expect(metricsB.every((m) => m.name === 'http_requests_total')).toBe(true)
  })

  it('isolates plugin controllers across distinct app instances', async () => {
    const runtimeA = createPluginRuntime()
    const runtimeB = createPluginRuntime()

    await runtimeA.loadPlugins([{ name: 'preview-revalidation', enabled: true }])
    await runtimeB.loadPlugins([{ name: 'seo-metadata', enabled: true }])

    const appA = createApp({ pluginRuntime: runtimeA })
    const appB = createApp({ pluginRuntime: runtimeB })

    // App A serves preview-revalidation health
    const resA = await appA.handle(
      new Request('http://localhost/api/admin/plugins/preview-revalidation/health')
    )
    expect(resA.status).toBe(200)

    // App A does NOT serve App B's seo-metadata health
    const resA_BRoute = await appA.handle(
      new Request('http://localhost/api/admin/plugins/seo-metadata/health')
    )
    expect(resA_BRoute.status).toBe(404)

    // App B serves seo-metadata health
    const resB = await appB.handle(
      new Request('http://localhost/api/admin/plugins/seo-metadata/health')
    )
    expect(resB.status).toBe(200)

    // App B does NOT serve App A's preview-revalidation health
    const resB_ARoute = await appB.handle(
      new Request('http://localhost/api/admin/plugins/preview-revalidation/health')
    )
    expect(resB_ARoute.status).toBe(404)
  })

  it('bootstrapApp performs environment validation and plugin loading on demand', async () => {
    // Fails if secret too short
    await expect(
      bootstrapApp({
        env: {
          BETTER_AUTH_SECRET: 'short',
        } as unknown as Env,
      })
    ).rejects.toThrow('BETTER_AUTH_SECRET must be configured and at least 32 characters long')

    // Succeeds with valid configuration
    const runtime = createPluginRuntime()
    const store = new Map<string, string>()
    const kv = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, val: string) => {
        store.set(key, val)
      }),
    } as unknown as KVNamespace

    const validEnv: Partial<Env> = {
      BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
      EDGE_PLUGINS_JSON: JSON.stringify([{ name: 'preview-revalidation', enabled: true }]),
      CACHE: kv,
    }

    const result = await bootstrapApp({
      env: validEnv as Env,
      pluginRuntime: runtime,
    })

    expect(result.bootstrapped).toBe(true)
    expect(runtime.getLoadedPlugins()).toHaveLength(1)
    expect(runtime.getLoadedPlugins()[0]?.name).toBe('preview-revalidation')
  })
})
