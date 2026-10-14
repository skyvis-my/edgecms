import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { Env } from '@/env'
import {
  cancelSchedule,
  getQueue,
  notifySchedule,
  SchedulerRequestError,
} from '@/scheduling/scheduler.service'

function okResponse(body = '{}'): Response {
  return new Response(body, { status: 200 })
}

function statusResponse(status: number, body = 'err'): Response {
  return new Response(body, { status })
}

describe('scheduler.service', () => {
  let fetchImpls: unknown[]
  let stubs: { fetch: ReturnType<typeof vi.fn> }[]
  let getCalls: unknown[][]
  let env: Env

  beforeEach(() => {
    fetchImpls = []
    stubs = []
    getCalls = []
    const namespace = {
      idFromName: vi.fn(() => ({ name: 'default' })),
      // Fresh stub per get() call so tests can assert no stub reuse.
      get: vi.fn(() => {
        const impl = fetchImpls.shift() as (() => Response | Promise<Response>) | unknown
        const stub = {
          fetch: vi.fn(async () => {
            if (impl === undefined) return okResponse()
            if (typeof impl === 'function') return (impl as () => Response | Promise<Response>)()
            throw impl
          }),
        }
        stubs.push(stub)
        getCalls.push([stub])
        return stub
      }),
    }
    env = { PUBLISH_SCHEDULER: namespace } as unknown as Env
  })

  it('notifySchedule posts to /add and checks response.ok', async () => {
    await notifySchedule(env, 'e1', 'publish', '2026-12-31T00:00:00Z', undefined, {
      maxAttempts: 1,
    })
    expect(stubs).toHaveLength(1)
    const stub = stubs[0]
    if (!stub) throw new Error('expected one scheduler stub')
    const [url, init] = stub.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://internal/add')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({ entryId: 'e1', transitionType: 'publish' })
    // Tail-latency bound present.
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('throws on non-retryable !ok without retrying', async () => {
    fetchImpls = [() => statusResponse(400, 'bad request')]
    await expect(
      notifySchedule(env, 'e1', 'publish', '2026-12-31T00:00:00Z', undefined, { maxAttempts: 3 })
    ).rejects.toBeInstanceOf(SchedulerRequestError)
    expect(getCalls).toHaveLength(1)
  })

  it('retries 503 with a fresh stub per attempt then succeeds', async () => {
    fetchImpls = [() => statusResponse(503, 'busy'), () => okResponse()]
    await notifySchedule(env, 'e1', 'publish', '2026-12-31T00:00:00Z', undefined, {
      maxAttempts: 3,
    })
    expect(getCalls).toHaveLength(2)
    expect(stubs[0]).not.toBe(stubs[1])
  })

  it('retries fetch throws (overload/network) then succeeds', async () => {
    fetchImpls = [new Error('DO overloaded'), new TypeError('fetch failed'), () => okResponse()]
    await notifySchedule(env, 'e1', 'unpublish', '2026-12-31T00:00:00Z', undefined, {
      maxAttempts: 3,
    })
    expect(getCalls).toHaveLength(3)
  })

  it('throws after exhausting the bounded retry budget', async () => {
    fetchImpls = [() => statusResponse(500), () => statusResponse(500), () => statusResponse(500)]
    await expect(
      notifySchedule(env, 'e1', 'publish', '2026-12-31T00:00:00Z', undefined, { maxAttempts: 3 })
    ).rejects.toBeInstanceOf(SchedulerRequestError)
    expect(getCalls).toHaveLength(3)
  })

  it('does not retry aborts (tail-latency bound)', async () => {
    const abort = new DOMException('Timeout', 'AbortError')
    fetchImpls = [abort, () => okResponse()]
    await expect(
      notifySchedule(env, 'e1', 'publish', '2026-12-31T00:00:00Z', undefined, { maxAttempts: 3 })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(getCalls).toHaveLength(1)
  })

  it('cancelSchedule posts to /remove', async () => {
    await cancelSchedule(env, 'e1', 'publish', { maxAttempts: 1 })
    const cancelStub = stubs[0]
    if (!cancelStub) throw new Error('expected one scheduler stub')
    const [url, init] = cancelStub.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://internal/remove')
    expect(JSON.parse(init.body as string)).toMatchObject({ entryId: 'e1' })
  })

  it('getQueue returns the queue and rejects malformed payloads', async () => {
    fetchImpls = [() => okResponse(JSON.stringify({ queue: [{ entryId: 'e1' }] }))]
    await expect(getQueue(env, { maxAttempts: 1 })).rejects.toBeInstanceOf(SchedulerRequestError)

    fetchImpls = [
      () =>
        okResponse(
          JSON.stringify({ queue: [{ entryId: 'e1', transitionType: 'publish', scheduledAt: 's' }] })
        ),
    ]
    // Fresh env mock state: reset call log.
    await expect(getQueue(env, { maxAttempts: 1 })).resolves.toEqual([
      { entryId: 'e1', transitionType: 'publish', scheduledAt: 's' },
    ])
  })
})
