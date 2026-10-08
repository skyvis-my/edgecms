import { describe, expect, it } from 'bun:test'
import {
  buildBenchmarkURL,
  buildRemotePublicReadReceiptTemplate,
  evaluatePublicReadTimings,
  parsePublicReadPerformanceOptions,
  percentile,
  runPublicReadPerformance,
  summarizeDurations,
  timeAndValidateRequest,
} from './public-read-performance'

describe('public read performance helpers', () => {
  it('computes nearest-rank percentiles from sorted timings', () => {
    expect(percentile([40, 10, 20, 30], 50)).toBe(20)
    expect(percentile([40, 10, 20, 30], 95)).toBe(40)
    expect(percentile([], 95)).toBe(0)
  })

  it('summarizes timing samples with p50 and p95', () => {
    expect(summarizeDurations([12, 10, 25, 18])).toEqual({
      count: 4,
      minMs: 10,
      maxMs: 25,
      p50Ms: 12,
      p95Ms: 25,
    })
  })

  it('reports local public-read threshold status separately from deployed proof', () => {
    const result = evaluatePublicReadTimings({
      mode: 'local',
      baseURL: 'http://127.0.0.1:8787',
      path: '/api/tenants/smoke/public/posts/hello',
      durationsMs: [14, 18, 21, 28],
    })

    expect(result.proof).toBe('local')
    expect(result.goal).toBe('Local public read p95')
    expect(result.thresholdMs).toBe(50)
    expect(result.summary.p95Ms).toBe(28)
    expect(result.passed).toBe(true)
  })

  it('reports remote mode without verified deployment identity as unverified proof', () => {
    const result = evaluatePublicReadTimings({
      mode: 'remote',
      baseURL: 'https://cms.example.test',
      path: '/api/tenants/acme/public/posts/launch',
      durationsMs: [80, 120, 160, 180],
    })

    expect(result.proof).toBe('remote')
    expect(result.deploymentVerified).toBe(false)
    expect(result.goal).toBe('Remote (unverified) public read p95')
    expect(result.thresholdMs).toBe(100)
    expect(result.summary.p95Ms).toBe(180)
    expect(result.passed).toBe(false)

    // Unverified remote cannot build a deployed receipt template
    expect(() =>
      buildRemotePublicReadReceiptTemplate(
        result,
        'EDGE_CMS_URL=https://cms.example.test bun run perf:public-read:remote -- --path /api/tenants/acme/public/posts/launch',
        '2026-06-09T00:00:00.000Z'
      )
    ).toThrow(/verified deployment identity/i)
  })

  it('builds remote receipt template when deployment identity is verified', () => {
    const result = evaluatePublicReadTimings({
      mode: 'remote',
      baseURL: 'https://cms.example.test',
      path: '/api/tenants/acme/public/posts/launch',
      durationsMs: [80, 120, 160, 180],
      deploymentIdentity: 'deploy-stage-2026-06',
    })

    expect(result.proof).toBe('deployed')
    expect(result.deploymentVerified).toBe(true)
    expect(result.goal).toBe('Deployed public read p95')
    expect(result.thresholdMs).toBe(100)
    expect(result.summary.p95Ms).toBe(180)

    expect(
      buildRemotePublicReadReceiptTemplate(
        result,
        'EDGE_CMS_URL=https://cms.example.test bun run perf:public-read:remote -- --path /api/tenants/acme/public/posts/launch',
        '2026-06-09T00:00:00.000Z'
      )
    ).toEqual({
      url: 'https://cms.example.test/api/tenants/acme/public/posts/launch',
      command:
        'EDGE_CMS_URL=https://cms.example.test bun run perf:public-read:remote -- --path /api/tenants/acme/public/posts/launch',
      measuredAt: '2026-06-09T00:00:00.000Z',
      p95Ms: 180,
      proof: 'deployed',
      deploymentIdentity: 'deploy-stage-2026-06',
    })
  })

  it('parses local defaults and explicit remote args', () => {
    expect(parsePublicReadPerformanceOptions([], {})).toEqual({
      mode: 'local',
      baseURL: 'http://127.0.0.1:8787',
      path: '/api/public/posts',
      samples: 20,
      warmup: 3,
    })

    expect(parsePublicReadPerformanceOptions([], { EDGE_CMS_PUBLIC_READ_PATH: '/api/public/posts' })).toEqual({
      mode: 'local',
      baseURL: 'http://127.0.0.1:8787',
      path: '/api/public/posts',
      samples: 20,
      warmup: 3,
    })

    expect(
      parsePublicReadPerformanceOptions(
        [
          '--mode',
          'remote',
          '--base-url=https://cms.example.test',
          '--path',
          '/api/public/posts',
          '--samples=5',
          '--warmup=1',
        ],
        {}
      )
    ).toEqual({
      mode: 'remote',
      baseURL: 'https://cms.example.test',
      path: '/api/public/posts',
      samples: 5,
      warmup: 1,
    })
  })

  it('builds a stable benchmark URL', () => {
    expect(buildBenchmarkURL('https://cms.example.test/', '/api/public/posts?locale=en')).toBe(
      'https://cms.example.test/api/public/posts?locale=en'
    )
  })
})

describe('public read performance workload validation (F02)', () => {
  it('rejects HTTP 200 with HTML response', async () => {
    const mockFetch = async () =>
      new Response('<!DOCTYPE html><html><body>Error page</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })

    await expect(
      runPublicReadPerformance(
        {
          mode: 'local',
          baseURL: 'http://127.0.0.1:8787',
          path: '/api/public/posts/hello',
          samples: 2,
          warmup: 1,
          expectation: { kind: 'detail', expectedId: 'e1' },
        },
        { fetchFn: mockFetch }
      )
    ).rejects.toThrow(/application\/json|html/i)
  })

  it('rejects malformed JSON payload', async () => {
    const mockFetch = async () =>
      new Response('{"entry": { id: invalid json }', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    await expect(
      runPublicReadPerformance(
        {
          mode: 'local',
          baseURL: 'http://127.0.0.1:8787',
          path: '/api/public/posts/hello',
          samples: 2,
          warmup: 1,
          expectation: { kind: 'detail', expectedId: 'e1' },
        },
        { fetchFn: mockFetch }
      )
    ).rejects.toThrow(/malformed json/i)
  })

  it('rejects business-error payload', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ error: 'Collection not found' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    await expect(
      runPublicReadPerformance(
        {
          mode: 'local',
          baseURL: 'http://127.0.0.1:8787',
          path: '/api/public/posts/hello',
          samples: 2,
          warmup: 1,
          expectation: { kind: 'detail', expectedId: 'e1' },
        },
        { fetchFn: mockFetch }
      )
    ).rejects.toThrow(/business error|not found/i)
  })

  it('rejects unexpected redirect response', async () => {
    const mockFetch = async () =>
      new Response(null, {
        status: 302,
        headers: { Location: '/login' },
      })

    await expect(
      runPublicReadPerformance(
        {
          mode: 'local',
          baseURL: 'http://127.0.0.1:8787',
          path: '/api/public/posts/hello',
          samples: 2,
          warmup: 1,
          expectation: { kind: 'detail', expectedId: 'e1' },
        },
        { fetchFn: mockFetch }
      )
    ).rejects.toThrow(/redirect/i)
  })

  it('rejects wrong entry fixture ID in detail workload', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          collection: { id: 'c1', name: 'Posts', slug: 'posts' },
          locale: 'en',
          entry: { id: 'wrong-entry-id', slug: 'hello', data: {} },
          generatedAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )

    await expect(
      runPublicReadPerformance(
        {
          mode: 'local',
          baseURL: 'http://127.0.0.1:8787',
          path: '/api/public/posts/hello',
          samples: 2,
          warmup: 1,
          expectation: { kind: 'detail', expectedId: 'correct-entry-id' },
        },
        { fetchFn: mockFetch }
      )
    ).rejects.toThrow(/fixture|expected entry id/i)
  })

  it('rejects wrong tenant fixture / missing tenant marker', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          collection: { id: 'c1', name: 'Posts', slug: 'posts' },
          locale: 'en',
          entry: { id: 'e1', slug: 'hello', data: {} },
          tenantId: 'tenant-beta',
          generatedAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )

    await expect(
      runPublicReadPerformance(
        {
          mode: 'local',
          baseURL: 'http://127.0.0.1:8787',
          path: '/api/public/posts/hello',
          samples: 2,
          warmup: 1,
          expectation: { kind: 'detail', expectedId: 'e1', tenantMarker: 'tenant-alpha' },
        },
        { fetchFn: mockFetch }
      )
    ).rejects.toThrow(/tenant/i)
  })

  it('rejects unexpected empty list when allowEmpty is false', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          collection: { id: 'c1', name: 'Posts', slug: 'posts' },
          locale: 'en',
          entries: [],
          total: 0,
          generatedAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )

    await expect(
      runPublicReadPerformance(
        {
          mode: 'local',
          baseURL: 'http://127.0.0.1:8787',
          path: '/api/public/posts',
          samples: 2,
          warmup: 1,
          expectation: { kind: 'list', allowEmpty: false },
        },
        { fetchFn: mockFetch }
      )
    ).rejects.toThrow(/empty list/i)
  })

  it('accepts valid expected empty list when allowEmpty is true', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          collection: { id: 'c1', name: 'Posts', slug: 'posts' },
          locale: 'en',
          entries: [],
          total: 0,
          generatedAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )

    const result = await runPublicReadPerformance(
      {
        mode: 'local',
        baseURL: 'http://127.0.0.1:8787',
        path: '/api/public/posts',
        samples: 2,
        warmup: 1,
        expectation: { kind: 'list', allowEmpty: true },
      },
      { fetchFn: mockFetch }
    )

    expect(result.passed).toBe(true)
    expect(result.summary.count).toBe(2)
  })

  it('accepts valid detail payload matching fixture and tenant marker', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          collection: { id: 'c1', name: 'Posts', slug: 'posts' },
          locale: 'en',
          entry: { id: 'e1', slug: 'hello', data: { title: 'Hello World' } },
          tenantId: 'tenant-alpha',
          generatedAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )

    const result = await runPublicReadPerformance(
      {
        mode: 'local',
        baseURL: 'http://127.0.0.1:8787',
        path: '/api/public/posts/hello',
        samples: 2,
        warmup: 1,
        expectation: { kind: 'detail', expectedId: 'e1', expectedSlug: 'hello', tenantMarker: 'tenant-alpha' },
      },
      { fetchFn: mockFetch }
    )

    expect(result.passed).toBe(true)
    expect(result.summary.count).toBe(2)
    expect(result.validationSummary).toBeDefined()
    expect(result.validationSummary?.count).toBe(2)
  })

  it('accepts valid list payload matching collection and entry fixture', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          collection: { id: 'c1', name: 'Posts', slug: 'posts' },
          locale: 'en',
          entries: [{ id: 'e1', slug: 'hello', data: {} }],
          total: 1,
          tenantId: 'tenant-alpha',
          generatedAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )

    const result = await runPublicReadPerformance(
      {
        mode: 'local',
        baseURL: 'http://127.0.0.1:8787',
        path: '/api/public/posts',
        samples: 2,
        warmup: 1,
        expectation: {
          kind: 'list',
          expectedCollection: 'posts',
          expectedId: 'e1',
          tenantMarker: 'tenant-alpha',
        },
      },
      { fetchFn: mockFetch }
    )

    expect(result.passed).toBe(true)
    expect(result.summary.count).toBe(2)
  })

  it('rejects run when workload expectation is missing', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    await expect(
      runPublicReadPerformance(
        {
          mode: 'local',
          baseURL: 'http://127.0.0.1:8787',
          path: '/api/public/posts',
          samples: 2,
          warmup: 1,
        },
        { fetchFn: mockFetch }
      )
    ).rejects.toThrow(/expectation or validator/i)
  })

  it('applies validation checks during warmup as well as measured samples', async () => {
    let callCount = 0
    const mockFetch = async () => {
      callCount += 1
      if (callCount === 1) {
        return new Response('Server Error', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        })
      }
      return new Response(JSON.stringify({ entry: { id: 'e1' }, collection: { slug: 'posts' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    await expect(
      runPublicReadPerformance(
        {
          mode: 'local',
          baseURL: 'http://127.0.0.1:8787',
          path: '/api/public/posts/e1',
          samples: 2,
          warmup: 1,
          expectation: { kind: 'detail', expectedId: 'e1' },
        },
        { fetchFn: mockFetch }
      )
    ).rejects.toThrow(/200/)
    expect(callCount).toBe(1)
  })

  it('measures request transfer time and validation overhead separately while reading body once', async () => {
    let bodyReadCount = 0
    const mockResponse = {
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: async () => {
        bodyReadCount += 1
        return JSON.stringify({
          collection: { id: 'c1', name: 'Posts', slug: 'posts' },
          locale: 'en',
          entry: { id: 'e1', slug: 'p1', data: {} },
        })
      },
    } as unknown as Response

    const mockFetch = async () => mockResponse

    let validatorCalled = false
    const timed = await timeAndValidateRequest({
      url: 'http://127.0.0.1:8787/api/public/posts/p1',
      fetchFn: mockFetch,
      validator: (res, body) => {
        validatorCalled = true
        expect(res.status).toBe(200)
        expect(body).toContain('e1')
      },
    })

    expect(validatorCalled).toBe(true)
    expect(bodyReadCount).toBe(1)
    expect(timed.durationMs).toBeGreaterThanOrEqual(0)
    expect(timed.validationMs).toBeGreaterThanOrEqual(0)
    expect(timed.status).toBe(200)
  })

  it('accepts valid singleton payload and rejects mismatching singleton fixture', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          collection: { id: 'c-singleton', name: 'Settings', slug: 'settings' },
          locale: 'en',
          entry: { id: 'e-settings', slug: 'global', data: { siteName: 'My Site' } },
          generatedAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )

    const result = await runPublicReadPerformance(
      {
        mode: 'local',
        baseURL: 'http://127.0.0.1:8787',
        path: '/api/public/singleton/settings',
        samples: 2,
        warmup: 1,
        expectation: {
          kind: 'singleton',
          expectedCollection: 'settings',
          expectedId: 'e-settings',
          expectedSlug: 'global',
        },
      },
      { fetchFn: mockFetch }
    )
    expect(result.passed).toBe(true)

    // Reject mismatching singleton ID
    await expect(
      runPublicReadPerformance(
        {
          mode: 'local',
          baseURL: 'http://127.0.0.1:8787',
          path: '/api/public/singleton/settings',
          samples: 2,
          warmup: 1,
          expectation: { kind: 'singleton', expectedId: 'e-wrong' },
        },
        { fetchFn: mockFetch }
      )
    ).rejects.toThrow(/fixture mismatch/i)
  })

  it('matches tenant marker in body content when tenant identity is not explicitly returned', async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          collection: { id: 'c1', name: 'Posts', slug: 'tenant-alpha-posts' },
          locale: 'en',
          entry: { id: 'e1', slug: 'p1', data: { brand: 'tenant-alpha' } },
          generatedAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )

    const result = await runPublicReadPerformance(
      {
        mode: 'local',
        baseURL: 'http://127.0.0.1:8787',
        path: '/api/public/posts/p1',
        samples: 2,
        warmup: 1,
        expectation: { kind: 'detail', expectedId: 'e1', tenantMarker: 'tenant-alpha' },
      },
      { fetchFn: mockFetch }
    )
    expect(result.passed).toBe(true)
  })

  it('rejects responses that have been redirected even if status is 200', async () => {
    const redirectedResponse = new Response(
      JSON.stringify({
        collection: { id: 'c1', slug: 'posts' },
        entry: { id: 'e1', slug: 'p1', data: {} },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
    Object.defineProperty(redirectedResponse, 'redirected', { value: true })
    Object.defineProperty(redirectedResponse, 'url', { value: 'http://127.0.0.1:8787/login' })

    const mockFetch = async () => redirectedResponse

    await expect(
      runPublicReadPerformance(
        {
          mode: 'local',
          baseURL: 'http://127.0.0.1:8787',
          path: '/api/public/posts/p1',
          samples: 2,
          warmup: 1,
          expectation: { kind: 'detail', expectedId: 'e1' },
        },
        { fetchFn: mockFetch }
      )
    ).rejects.toThrow(/redirect/i)
  })

  it('parses workload expectation CLI flags', () => {
    expect(
      parsePublicReadPerformanceOptions(
        [
          '--expected-kind=detail',
          '--expected-id=e-123',
          '--expected-slug=my-post',
          '--expected-collection=posts',
          '--tenant-marker=tenant-xyz',
          '--allow-empty',
        ],
        { EDGE_CMS_PUBLIC_READ_PATH: '/api/public/posts/e-123' }
      )
    ).toEqual({
      mode: 'local',
      baseURL: 'http://127.0.0.1:8787',
      path: '/api/public/posts/e-123',
      samples: 20,
      warmup: 3,
      expectation: {
        kind: 'detail',
        expectedId: 'e-123',
        expectedSlug: 'my-post',
        expectedCollection: 'posts',
        tenantMarker: 'tenant-xyz',
        allowEmpty: true,
      },
    })
  })
})

describe('public read performance verification and failure accounting (F03)', () => {
  it('rejects empty durations at evaluation', () => {
    expect(() =>
      evaluatePublicReadTimings({
        mode: 'local',
        baseURL: 'http://127.0.0.1:8787',
        path: '/api/public/posts',
        durationsMs: [],
      })
    ).toThrow(/evaluation rejected: measured durations cannot be empty/i)
  })

  it('rejects non-finite durations at evaluation', () => {
    expect(() =>
      evaluatePublicReadTimings({
        mode: 'local',
        baseURL: 'http://127.0.0.1:8787',
        path: '/api/public/posts',
        durationsMs: [12, NaN],
      })
    ).toThrow(/evaluation rejected: measured durations must be finite numbers/i)

    expect(() =>
      evaluatePublicReadTimings({
        mode: 'local',
        baseURL: 'http://127.0.0.1:8787',
        path: '/api/public/posts',
        durationsMs: [12, Infinity],
      })
    ).toThrow(/evaluation rejected: measured durations must be finite numbers/i)
  })

  it('records bounded request timeouts as failures and preserves them in receipt', async () => {
    const timingOutFetch = async () => {
      // Simulate hanging request that triggers timeout
      await new Promise((resolve) => setTimeout(resolve, 100))
      return new Response(JSON.stringify({ entry: { id: 'e1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await runPublicReadPerformance(
      {
        mode: 'local',
        baseURL: 'http://127.0.0.1:8787',
        path: '/api/public/posts/e1',
        samples: 2,
        warmup: 0,
        timeoutMs: 20,
        expectation: { kind: 'detail', expectedId: 'e1' },
      },
      { fetchFn: timingOutFetch }
    )

    expect(result.counts.attempted).toBe(2)
    expect(result.counts.valid).toBe(0)
    expect(result.counts.failed).toBe(2)
    expect(result.passed).toBe(false)
    expect(result.failures).toBeDefined()
    expect(result.failures).toHaveLength(2)
    expect(result.failures?.[0]?.timedOut).toBe(true)
    expect(result.failures?.[0]?.error).toContain('timed out')
  })

  it('reconciles attempted, completed, valid, and failed counts with partial failures', async () => {
    let callIndex = 0
    const mixedFetch = async () => {
      callIndex += 1
      if (callIndex === 2) {
        // One failure: return 500
        return new Response('Internal Server Error', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        })
      }
      return new Response(
        JSON.stringify({
          collection: { slug: 'posts' },
          entry: { id: 'e1', slug: 'p1' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const result = await runPublicReadPerformance(
      {
        mode: 'local',
        baseURL: 'http://127.0.0.1:8787',
        path: '/api/public/posts/p1',
        samples: 3,
        warmup: 0,
        expectation: { kind: 'detail', expectedId: 'e1' },
      },
      { fetchFn: mixedFetch }
    )

    // Reconciled counts
    expect(result.counts.attempted).toBe(3)
    expect(result.counts.valid).toBe(2)
    expect(result.counts.failed).toBe(1)
    expect(result.counts.attempted).toBe(result.counts.valid + result.counts.failed)

    // Failed results do not disappear from receipt
    expect(result.failures).toHaveLength(1)
    expect(result.failures?.[0]?.iteration).toBe(1)

    // Any failure causes overall passed = false
    expect(result.passed).toBe(false)

    // Timing summary only reflects valid samples
    expect(result.summary.count).toBe(2)
  })

  it('parses timeout and deployment identity options', () => {
    const parsed = parsePublicReadPerformanceOptions([
      '--mode',
      'remote',
      '--base-url=https://cms.prod.test',
      '--path=/api/public/posts',
      '--timeout-ms=2500',
      '--deployment-id=worker-prod-987',
    ])

    expect(parsed.timeoutMs).toBe(2500)
    expect(parsed.deploymentIdentity).toBe('worker-prod-987')
    expect(parsed.mode).toBe('remote')
  })
})
