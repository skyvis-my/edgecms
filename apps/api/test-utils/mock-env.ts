import { vi } from 'bun:test'
import type { CommandContext } from '@/commands/engine'
import type { Env } from '@/main'
import { asCommandEnv } from './typed-mock'

/**
 * Mock D1 Prepared Statement
 */
export interface MockD1PreparedStatement {
  bind: ReturnType<typeof vi.fn>
  first: ReturnType<typeof vi.fn>
  all: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  raw: ReturnType<typeof vi.fn>
}

/**
 * Create a mock D1 prepared statement with all required methods.
 */
export function createMockD1Statement(): MockD1PreparedStatement {
  const statement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [], success: true, meta: {} }),
    run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
    raw: vi.fn().mockResolvedValue([]),
  }
  return statement as unknown as MockD1PreparedStatement
}

/**
 * Create a mock D1 database with all required methods.
 */
export function createMockD1(): D1Database {
  const mockStatement = createMockD1Statement()

  return {
    prepare: vi.fn().mockReturnValue(mockStatement),
    batch: vi.fn().mockResolvedValue([]),
    exec: vi.fn().mockResolvedValue({ count: 0, duration: 0 }),
    dump: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  } as unknown as D1Database
}

/**
 * Create a mock KV namespace with all required methods.
 */
export function createMockKV(): KVNamespace {
  const store = new Map<string, string>()

  return {
    get: vi.fn().mockImplementation(async (key: string) => store.get(key) || null),
    put: vi.fn().mockImplementation(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn().mockImplementation(async (key: string) => {
      store.delete(key)
    }),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true, cursor: '' }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace
}

/**
 * Create a mock R2 bucket with all required methods.
 */
export function createMockR2(): R2Bucket {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue({
      key: 'test-key',
      version: 'test-version',
      size: 0,
      etag: 'test-etag',
      httpEtag: 'test-http-etag',
      checksums: {},
      uploaded: new Date(),
    }),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ objects: [], truncated: false, delimitedPrefixes: [] }),
    head: vi.fn().mockResolvedValue(null),
  } as unknown as R2Bucket
}

/**
 * Create a mock Fetcher for assets binding.
 */
export function createMockFetcher(): Fetcher {
  return {
    fetch: vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })),
  } as unknown as Fetcher
}

/**
 * Create a mock Durable Object Namespace for PUBLISH_SCHEDULER.
 */
export function createMockDurableObjectNamespace(): DurableObjectNamespace {
  const mockStub = {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    ),
  }

  const mockId = {
    toString: () => 'test-do-id',
    equals: () => false,
  } as DurableObjectId

  return {
    idFromName: vi.fn().mockReturnValue(mockId),
    idFromString: vi.fn().mockReturnValue(mockId),
    newUniqueId: vi.fn().mockReturnValue(mockId),
    get: vi.fn().mockReturnValue(mockStub),
    jurisdiction: vi.fn(),
  } as unknown as DurableObjectNamespace
}

/**
 * Create a mock Cloudflare Queue for WEBHOOK_QUEUE.
 */
export function createMockQueue(): Queue {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue([]),
  } as unknown as Queue
}

/**
 * Create a complete mock environment with all Cloudflare bindings.
 *
 * @example
 * ```typescript
 * const env = createMockEnv()
 * // Use in tests
 * const result = await myService.create(env.DB, data)
 * ```
 */
export function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    DB: createMockD1(),
    CACHE: createMockKV(),
    MEDIA: createMockR2(),
    ASSETS: createMockFetcher(),
    PUBLISH_SCHEDULER: createMockDurableObjectNamespace(),
    WEBHOOK_QUEUE: createMockQueue(),
    BETTER_AUTH_SECRET: 'test-secret-key-for-testing-only',
    ...overrides,
  }
}

/**
 * Create command-context compatible env for command handler/controller tests.
 */
export function createMockCommandEnv(overrides?: Partial<Env>): CommandContext['env'] {
  return asCommandEnv(createMockEnv(overrides))
}
