import { describe, expect, it, mock, spyOn, vi } from 'bun:test'
import { Database as BunSqlite } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drizzle as drizzleBunSqlite } from 'drizzle-orm/bun-sqlite'
import { Elysia } from 'elysia'
import type { CommandEnvelope, CommandResult } from '@edgecms/schemas/commands'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { createUsageRecorder, createD1UsageRollupSink, noopUsageSink } = await import(
  '@/host/usage'
)
const {
  createLimitEnforcer,
  defaultTenantLimits,
  respondLimitExceeded,
  sanitizeUpgradeUrl,
  toLimitExceeded,
} = await import('@/host/limits')
const { createHostRuntime, createHostRuntimePlugin, getHostRuntime } = await import(
  '@/host/host-context'
)
const { createCommandHostHooks, getCommandLimitError } = await import('@/host/command-hooks')
const { createAiHostHooks } = await import('@/host/ai-hooks')
const { resolveHostPolicies } = await import('@/host/host-policies')
const { executeCommand } = await import('@/commands/engine')
const { usageRepository } = await import('@/usage/usage.repository')
const { tenantsService } = await import('@/tenants/tenants.service')
const { toServiceResponse } = await import('@/shared/utils/service-response')

type UsageEvent = import('@/host/usage').UsageEvent
type HostRuntime = import('@/host/host-context').HostRuntime

const acme = { id: 't-acme', slug: 'acme', name: 'Acme', status: 'active' }
const globex = { id: 't-globex', slug: 'globex', name: 'Globex', status: 'active' }

/** Collects deferred work like a Worker's `waitUntil`. */
function waitUntilSource() {
  const pending: Promise<unknown>[] = []
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p)
    },
    settle: () => Promise.all(pending),
    pending,
  }
}

function collectingSink() {
  const events: UsageEvent[] = []
  return { events, record: (batch: UsageEvent[]) => void events.push(...batch) }
}

function envelope(type: CommandEnvelope['type'], extra: Partial<CommandEnvelope> = {}) {
  return {
    type,
    payload: {},
    actor: { userId: 'u1', source: 'admin' },
    timestamp: new Date().toISOString(),
    ...extra,
  } as CommandEnvelope
}

function success(type: CommandResult['type'], data?: Record<string, unknown>): CommandResult {
  return {
    commandId: crypto.randomUUID(),
    type,
    status: 'success',
    ...(data && { data }),
    executedAt: new Date().toISOString(),
  }
}

describe('HS-05 usage recorder', () => {
  it('a throwing or rejecting sink never fails the caller', async () => {
    const throwing = createUsageRecorder({
      record: () => {
        throw new Error('sink down')
      },
    })
    const rejecting = createUsageRecorder({ record: async () => Promise.reject(new Error('down')) })
    const source = waitUntilSource()

    expect(() =>
      throwing.record(source, { tenantId: 't1', metric: 'public_reads', quantity: 1 })
    ).not.toThrow()
    expect(() =>
      rejecting.record(source, { tenantId: 't1', metric: 'public_reads', quantity: 1 })
    ).not.toThrow()
    // Errors are swallowed inside waitUntil, never surfaced as rejections.
    await expect(source.settle()).resolves.toBeDefined()
  })

  it('does not wait for a slow sink', async () => {
    let release!: () => void
    const recorder = createUsageRecorder({
      record: () => new Promise<void>((resolve) => (release = resolve)),
    })
    const source = waitUntilSource()
    recorder.record(source, { tenantId: 't1', metric: 'admin_mutations', quantity: 1 })
    // record() returned synchronously; the slow write is parked on waitUntil.
    expect(source.pending).toHaveLength(1)
    await Promise.resolve()
    release()
    await source.settle()
  })

  it('stamps events and skips untenanted or zero events', async () => {
    const sink = collectingSink()
    const recorder = createUsageRecorder(sink)
    const source = waitUntilSource()
    recorder.record(source, [
      { tenantId: 't1', metric: 'media_bytes', quantity: 10 },
      { tenantId: '', metric: 'media_bytes', quantity: 10 },
      { tenantId: 't1', metric: 'entries', quantity: 0 },
    ])
    await source.settle()
    expect(sink.events).toHaveLength(1)
    expect(sink.events[0]).toMatchObject({ tenantId: 't1', metric: 'media_bytes', quantity: 10 })
    expect(typeof sink.events[0]!.timestamp).toBe('string')
  })

  it('without a host sink, recording is a no-op', () => {
    const source = waitUntilSource()
    createUsageRecorder(undefined).record(source, {
      tenantId: 't1',
      metric: 'public_reads',
      quantity: 1,
    })
    createUsageRecorder(noopUsageSink).record(source, {
      tenantId: 't1',
      metric: 'public_reads',
      quantity: 1,
    })
    expect(source.pending).toHaveLength(0)
  })
})

describe('HS-05 public read metering', () => {
  function publicApp(runtime: HostRuntime) {
    return new Elysia()
      .use(createHostRuntimePlugin(runtime))
      .derive({ as: 'global' }, ({ params }) => {
        const slug = (params as { tenantSlug?: string }).tenantSlug
        const tenant = slug === 'acme' ? acme : slug === 'globex' ? globex : undefined
        return tenant ? { tenant: { tenant, resources: { mode: 'shared' as const } } } : {}
      })
      .get('/api/tenants/:tenantSlug/api/public/articles', () => ({ success: true, data: [] }))
      .get('/api/tenants/:tenantSlug/api/public/missing', ({ set }) => {
        set.status = 404
        return { success: false }
      })
      .get('/api/tenants/:tenantSlug/api/admin/entries', () => ({ success: true }))
  }

  it('counts successful public reads per tenant', async () => {
    const sink = collectingSink()
    const app = publicApp(createHostRuntime({ usageSink: sink }))

    await app.handle(new Request('http://x/api/tenants/acme/api/public/articles'))
    await app.handle(new Request('http://x/api/tenants/acme/api/public/articles'))
    await app.handle(new Request('http://x/api/tenants/globex/api/public/articles'))
    await app.handle(new Request('http://x/api/tenants/acme/api/public/missing'))
    await app.handle(new Request('http://x/api/tenants/acme/api/admin/entries'))
    await new Promise((r) => setTimeout(r, 0))

    const byTenant = (id: string) =>
      sink.events.filter((e) => e.tenantId === id && e.metric === 'public_reads').length
    expect(byTenant('t-acme')).toBe(2)
    expect(byTenant('t-globex')).toBe(1)
    expect(sink.events).toHaveLength(3)
  })

  it('a failing sink does not fail the public read', async () => {
    const app = publicApp(
      createHostRuntime({
        usageSink: {
          record: () => {
            throw new Error('sink down')
          },
        },
      })
    )
    const res = await app.handle(new Request('http://x/api/tenants/acme/api/public/articles'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: [] })
  })

  it('separate app instances keep separate runtimes', async () => {
    const a = collectingSink()
    const b = collectingSink()
    const appA = publicApp(createHostRuntime({ usageSink: a }))
    const appB = publicApp(createHostRuntime({ usageSink: b }))
    await appA.handle(new Request('http://x/api/tenants/acme/api/public/articles'))
    await appB.handle(new Request('http://x/api/tenants/globex/api/public/articles'))
    await new Promise((r) => setTimeout(r, 0))
    expect(a.events.map((e) => e.tenantId)).toEqual(['t-acme'])
    expect(b.events.map((e) => e.tenantId)).toEqual(['t-globex'])
    // A request that never went through an app gets the no-op defaults.
    expect(await getHostRuntime(new Request('http://x')).limits.check(undefined, {
      dimension: 'commands',
      amount: 1,
      tenant: acme,
    })).toBeNull()
  })
})

describe('HS-05 D1 daily rollup sink', () => {
  function sqliteDb() {
    const sqlite = new BunSqlite(':memory:')
    sqlite.exec(
      readFileSync(join(import.meta.dir, '../../../drizzle/migrations/0032_usage_daily.sql'), 'utf8')
    )
    const db = drizzleBunSqlite(sqlite)
    // bun:sqlite has no D1 batch; run the statements in order instead.
    return Object.assign(db, {
      batch: async (queries: PromiseLike<unknown>[]) => {
        for (const query of queries) await query
      },
    })
  }

  it('sums events per tenant, day, metric and tier', async () => {
    const db = sqliteDb()
    const sink = createD1UsageRollupSink({ db: db as never, flushIntervalMs: 60_000 })
    const at = '2026-10-22T10:00:00.000Z'
    await sink.record([
      { tenantId: 't1', metric: 'public_reads', quantity: 1, timestamp: at },
      { tenantId: 't1', metric: 'public_reads', quantity: 1, timestamp: at },
      { tenantId: 't2', metric: 'public_reads', quantity: 1, timestamp: at },
      { tenantId: 't1', metric: 'ai_tokens', quantity: 120, detail: 'nano', timestamp: at },
      { tenantId: 't1', metric: 'ai_tokens', quantity: 900, detail: 'heavy', timestamp: at },
      { tenantId: 't1', metric: 'media_bytes', quantity: 500, timestamp: at },
      { tenantId: 't1', metric: 'media_bytes', quantity: -200, timestamp: at },
    ])
    await sink.flush()
    await sink.record([{ tenantId: 't1', metric: 'public_reads', quantity: 1, timestamp: at }])
    await sink.flush()

    const rows = await usageRepository.findDaily(db as never, 't1', '2026-10-22')
    const value = (metric: string, detail = '') =>
      rows.find((r) => r.metric === metric && r.detail === detail)?.value
    expect(value('public_reads')).toBe(3)
    expect(value('ai_tokens', 'nano')).toBe(120)
    expect(value('ai_tokens', 'heavy')).toBe(900)
    expect(value('media_bytes')).toBe(300)
    const other = await usageRepository.findDaily(db as never, 't2', '2026-10-22')
    expect(other.map((r) => [r.metric, r.value])).toEqual([['public_reads', 1]])
  })

  it('buffers until the interval and keeps rows when a flush fails', async () => {
    let now = 0
    const spy = spyOn(usageRepository, 'addDailyDeltas')
    spy.mockRejectedValueOnce(new Error('D1 down'))
    spy.mockResolvedValue(undefined)
    const sink = createD1UsageRollupSink({ db: {} as never, flushIntervalMs: 1000, now: () => now })
    const at = '2026-10-22T00:00:00.000Z'

    await sink.record([{ tenantId: 't1', metric: 'entries', quantity: 1, timestamp: at }])
    expect(spy).not.toHaveBeenCalled()
    now = 1000
    await sink.record([{ tenantId: 't1', metric: 'entries', quantity: 1, timestamp: at }])
    expect(spy).toHaveBeenCalledTimes(1)
    // The failed batch is retried with the next flush.
    await sink.flush()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[1]![1]).toEqual([
      { tenantId: 't1', day: '2026-10-22', metric: 'entries', detail: '', value: 2 },
    ])
    spy.mockRestore()
  })
})

describe('HS-06 limit errors', () => {
  it('maps quota denials to 402 QUOTA_EXCEEDED and rate denials to 429 RATE_LIMITED', () => {
    const quota = toLimitExceeded('media_bytes', {
      allowed: false,
      limit: 100,
      used: 100,
      upgradeUrl: 'https://host.example/upgrade',
    })
    expect(quota).toEqual({
      status: 402,
      code: 'QUOTA_EXCEEDED',
      message: 'Quota exceeded for media_bytes',
      details: {
        dimension: 'media_bytes',
        kind: 'quota',
        limit: 100,
        used: 100,
        upgradeUrl: 'https://host.example/upgrade',
      },
    })

    const rate = toLimitExceeded('commands', { allowed: false, kind: 'rate', retryAfterSeconds: 2.2 })
    expect(rate.status).toBe(429)
    expect(rate.code).toBe('RATE_LIMITED')
    const set = { status: 200 as unknown, headers: {} as Record<string, unknown> }
    const body = respondLimitExceeded(set, rate)
    expect(set.status).toBe(429)
    expect(set.headers['Retry-After']).toBe('3')
    expect(body).toEqual({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Rate limit reached for commands',
        details: { dimension: 'commands', kind: 'rate', retryAfterSeconds: 3 },
      },
    })
  })

  it('drops upgrade URLs that are not absolute http(s)', () => {
    expect(sanitizeUpgradeUrl('javascript:alert(1)')).toBeUndefined()
    expect(sanitizeUpgradeUrl('/billing')).toBeUndefined()
    expect(sanitizeUpgradeUrl('https://host.example/plans')).toBe('https://host.example/plans')
  })
})

describe('HS-06 limit enforcer', () => {
  function publisher() {
    const published: Array<{ event: string; tenant: { id: string }; details: unknown }> = []
    return {
      published,
      publish: async (event: string, tenant: { id: string }, details?: unknown) => {
        published.push({ event, tenant, details })
      },
    }
  }

  it('allows everything without a host provider', async () => {
    expect(await createLimitEnforcer().check(undefined, { dimension: 'commands', amount: 1 })).toBeNull()
    expect(
      await createLimitEnforcer({ limits: defaultTenantLimits }).check(undefined, {
        dimension: 'media_bytes',
        amount: 10 ** 12,
        tenant: { ...acme, mediaUploadMaxBytes: 1 },
      })
    ).toBeNull()
  })

  it('fails open when the provider throws', async () => {
    const enforcer = createLimitEnforcer({
      limits: {
        check: () => {
          throw new Error('billing down')
        },
      },
    })
    expect(await enforcer.check(undefined, { dimension: 'commands', amount: 1, tenant: acme })).toBeNull()
  })

  it('emits tenant.limit_reached once per tenant, dimension and period', async () => {
    const events = publisher()
    let period = '2026-10'
    const enforcer = createLimitEnforcer({
      limits: { check: () => ({ allowed: false, period, upgradeUrl: 'https://h.example/up' }) },
      events: events as never,
    })
    const source = waitUntilSource()
    for (let i = 0; i < 3; i++) {
      expect(
        (await enforcer.check(source, { dimension: 'commands', amount: 1, tenant: acme }))?.status
      ).toBe(402)
    }
    await enforcer.check(source, { dimension: 'entries', amount: 1, tenant: acme })
    await enforcer.check(source, { dimension: 'commands', amount: 1, tenant: globex })
    await source.settle()
    expect(events.published.map((e) => [e.tenant.id, (e.details as { limit: { dimension: string } }).limit.dimension])).toEqual([
      ['t-acme', 'commands'],
      ['t-acme', 'entries'],
      ['t-globex', 'commands'],
    ])
    expect(events.published[0]!.details).toMatchObject({
      limit: { kind: 'quota', period: '2026-10', upgradeUrl: 'https://h.example/up' },
    })

    period = '2026-11'
    await enforcer.check(source, { dimension: 'commands', amount: 1, tenant: acme })
    await source.settle()
    expect(events.published).toHaveLength(4)
  })

  it('dedupes across instances through the KV marker', async () => {
    const store = new Map<string, string>()
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => void store.set(k, v),
    } as unknown as KVNamespace
    const events = publisher()
    const make = () =>
      createLimitEnforcer({
        limits: { check: () => ({ allowed: false, period: 'p1' }) },
        events: events as never,
        kv: () => kv,
      })
    const source = waitUntilSource()
    await make().check(source, { dimension: 'commands', amount: 1, tenant: acme })
    await source.settle()
    await make().check(source, { dimension: 'commands', amount: 1, tenant: acme })
    await source.settle()
    expect(events.published).toHaveLength(1)
  })

  it('does not emit for tenant creation, which has no tenant yet', async () => {
    const events = publisher()
    const enforcer = createLimitEnforcer({ limits: { check: () => false }, events: events as never })
    const source = waitUntilSource()
    expect((await enforcer.check(source, { dimension: 'tenants', amount: 1 }))?.code).toBe('QUOTA_EXCEEDED')
    await source.settle()
    expect(events.published).toHaveLength(0)
  })
})

describe('HS-05/HS-06 command hooks', () => {
  function runtimeWith(check: (input: { dimension: string; amount: number }) => unknown) {
    const sink = collectingSink()
    const runtime = createHostRuntime({
      usageSink: sink,
      limits: { check: check as never },
    })
    return { runtime, sink }
  }

  it('rejects a command over quota with a typed result the controller maps to 402', async () => {
    const { runtime } = runtimeWith((input) =>
      input.dimension === 'entries'
        ? { allowed: false, limit: 10, used: 10, upgradeUrl: 'https://h.example/up' }
        : true
    )
    const source = waitUntilSource()
    const hooks = createCommandHostHooks(runtime, { source, tenant: acme, actorId: 'u1' })!

    expect(await hooks.beforeExecute!(envelope('updateEntry'))).toBeUndefined()
    const rejected = await hooks.beforeExecute!(envelope('createEntry'))
    expect(rejected).toMatchObject({ status: 'failed', error: { code: 'QUOTA_EXCEEDED' } })
    expect(getCommandLimitError(rejected!)).toEqual({
      status: 402,
      details: {
        dimension: 'entries',
        kind: 'quota',
        limit: 10,
        used: 10,
        upgradeUrl: 'https://h.example/up',
      },
    })
    // Ordinary engine failures are not limit errors.
    expect(
      getCommandLimitError({ error: { code: 'VALIDATION_ERROR', message: 'x' } })
    ).toBeUndefined()
  })

  it('counts createEntry commands inside a transaction against the entries limit', async () => {
    const seen: Array<{ dimension: string; amount: number }> = []
    const { runtime } = runtimeWith((input) => {
      seen.push(input)
      return true
    })
    const hooks = createCommandHostHooks(runtime, { source: undefined, tenant: acme })!
    await hooks.beforeExecute!(
      envelope('transaction', {
        payload: {
          commands: [envelope('createEntry'), envelope('createEntry'), envelope('deleteEntry')],
        },
      })
    )
    expect(seen).toEqual([
      expect.objectContaining({ dimension: 'commands', amount: 1 }),
      expect.objectContaining({ dimension: 'entries', amount: 2 }),
    ])
  })

  it('meters successful mutations and entry deltas for the tenant', async () => {
    const { runtime, sink } = runtimeWith(() => true)
    const source = waitUntilSource()
    const hooks = createCommandHostHooks(runtime, { source, tenant: acme })!

    hooks.afterExecute!(envelope('createEntry'), success('createEntry'))
    hooks.afterExecute!(envelope('deleteEntry'), { ...success('deleteEntry'), status: 'failed' })
    hooks.afterExecute!(
      envelope('transaction'),
      success('transaction', {
        subResults: [
          { type: 'createEntry', status: 'success' },
          { type: 'createEntry', status: 'failed' },
          { type: 'deleteEntry', status: 'success' },
          { type: 'deleteEntry', status: 'success' },
        ],
      })
    )
    await source.settle()

    expect(sink.events.map((e) => [e.tenantId, e.metric, e.quantity])).toEqual([
      ['t-acme', 'admin_mutations', 1],
      ['t-acme', 'entries', 1],
      ['t-acme', 'admin_mutations', 1],
      ['t-acme', 'entries', -1],
    ])
  })

  it('global routes are neither limited nor metered', () => {
    const { runtime } = runtimeWith(() => false)
    expect(createCommandHostHooks(runtime, { source: undefined, tenant: undefined })).toBeUndefined()
    expect(createAiHostHooks(runtime, { source: undefined, tenant: undefined })).toBeUndefined()
  })

  it('the engine returns the rejection without running the command, and skips hooks on dry runs', async () => {
    const db = new Proxy({}, {
      get: () => {
        throw new Error('db must not be touched')
      },
    })
    const rejection: CommandResult = {
      commandId: 'c1',
      type: 'createEntry',
      status: 'failed',
      error: { code: 'QUOTA_EXCEEDED', message: 'over' },
      executedAt: new Date().toISOString(),
    }
    const beforeExecute = vi.fn(async () => rejection)
    const result = await executeCommand(
      { db: db as never, actor: { userId: 'u1', source: 'admin' }, hostHooks: { beforeExecute } },
      envelope('createEntry')
    )
    expect(result).toBe(rejection)

    const dryRunHooks = { beforeExecute: vi.fn(), afterExecute: vi.fn() }
    await executeCommand(
      { db: db as never, actor: { userId: 'u1', source: 'admin' }, hostHooks: dryRunHooks },
      envelope('createEntry', { dryRun: true })
    ).catch(() => undefined)
    expect(dryRunHooks.beforeExecute).not.toHaveBeenCalled()
  })
})

describe('HS-05/HS-06 AI hooks', () => {
  it('checks the ai_tokens budget and records tokens by tier', async () => {
    const sink = collectingSink()
    const checks: Array<{ dimension: string; amount: number }> = []
    const runtime = createHostRuntime({
      usageSink: sink,
      limits: {
        check: (input) => {
          checks.push(input)
          return { allowed: false, kind: 'rate', retryAfterSeconds: 30 }
        },
      },
    })
    const source = waitUntilSource()
    const hooks = createAiHostHooks(runtime, { source, tenant: acme, actorId: 'u1' })!

    const exceeded = await hooks.checkQuota()
    expect(exceeded).toMatchObject({ status: 429, code: 'RATE_LIMITED' })
    expect(checks[0]).toMatchObject({ dimension: 'ai_tokens', amount: 0 })

    hooks.onUsage({ tier: 'mid', inputTokens: 300, outputTokens: 45 })
    await source.settle()
    expect(sink.events).toEqual([
      expect.objectContaining({ tenantId: 't-acme', metric: 'ai_tokens', quantity: 345, detail: 'mid' }),
    ])
  })
})

describe('HS-06 tenant creation quota', () => {
  const actor = { userId: 'u1', email: 'a@example.com', isSuperAdmin: false, source: 'onboarding' as const }

  it('returns QUOTA_EXCEEDED with details, mapped to 402', async () => {
    const enforcer = createLimitEnforcer({
      limits: { check: () => ({ allowed: false, upgradeUrl: 'https://h.example/up' }) },
    })
    const result = await tenantsService.authorizeCreation(actor, resolveHostPolicies(), enforcer)
    expect(result as unknown).toEqual({
      success: false,
      error: {
        code: 'QUOTA_EXCEEDED',
        message: 'Quota exceeded for tenants',
        details: { dimension: 'tenants', kind: 'quota', upgradeUrl: 'https://h.example/up' },
      },
    })
    const set: { status?: unknown } = {}
    toServiceResponse(set, result)
    expect(set.status).toBe(402)
  })

  it('keeps today behavior without a limits provider', async () => {
    const result = await tenantsService.authorizeCreation(actor, resolveHostPolicies())
    expect(result).toEqual({ success: true, data: { initialStatus: 'active' } })
  })
})
