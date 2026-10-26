import { describe, expect, it, mock } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  env: {},
}))

const { Elysia } = await import('elysia')
const { createRequestObservabilityPlugin } = await import('../../observability/request-observability.plugin')

describe('createRequestObservabilityPlugin Server-Timing', () => {
  it('emits Server-Timing: total;dur=... on completed routes', async () => {
    const app = new Elysia()
      .use(createRequestObservabilityPlugin())
      .get('/test', () => ({ ok: true }))

    const res = await app.handle(new Request('http://localhost/test'))
    expect(res.status).toBe(200)

    const serverTiming = res.headers.get('Server-Timing')
    expect(serverTiming).toBeDefined()
    expect(serverTiming).toMatch(/total;dur=\d+(\.\d+)?/)
  })

  it('preserves existing Server-Timing segments and appends total;dur=...', async () => {
    const app = new Elysia()
      .use(createRequestObservabilityPlugin())
      .get('/cached', ({ set }) => {
        set.headers['Server-Timing'] = 'cache;desc="hit";dur=0.5'
        return { ok: true }
      })

    const res = await app.handle(new Request('http://localhost/cached'))
    expect(res.status).toBe(200)

    const serverTiming = res.headers.get('Server-Timing')
    expect(serverTiming).toBeDefined()
    expect(serverTiming).toContain('cache;desc="hit";dur=0.5')
    expect(serverTiming).toContain('total;dur=')
  })

  it('preserves existing lowercase server-timing header without duplicate casing', async () => {
    const app = new Elysia()
      .use(createRequestObservabilityPlugin())
      .get('/lowercase', ({ set }) => {
        set.headers['server-timing'] = 'db;dur=12.5'
        return { ok: true }
      })

    const res = await app.handle(new Request('http://localhost/lowercase'))
    expect(res.status).toBe(200)

    const serverTiming = res.headers.get('server-timing')
    expect(serverTiming).toBeDefined()
    expect(serverTiming).toContain('db;dur=12.5')
    expect(serverTiming).toContain('total;dur=')
  })
})
