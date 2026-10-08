import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'

const mockSync = vi.fn()
const mockSyncStateGet = vi.fn().mockResolvedValue({ lastSyncAt: '2026-01-15T10:00:00.000Z' })
const mockRefreshCounts = vi.fn().mockResolvedValue(undefined)
const mockSetStatus = vi.fn()
const mockSetError = vi.fn()
const mockSetLastSyncAt = vi.fn()

const storeState = {
  status: 'idle' as const,
  setStatus: (...args: unknown[]) => mockSetStatus(...args),
  setError: (...args: unknown[]) => mockSetError(...args),
  setLastSyncAt: (...args: unknown[]) => mockSetLastSyncAt(...args),
  refreshCounts: (...args: unknown[]) => mockRefreshCounts(...args),
}

vi.mock('./sync-engine', () => ({
  sync: (...args: unknown[]) => mockSync(...args),
}))

vi.mock('./local-db', () => ({
  db: {
    syncState: {
      get: (...args: unknown[]) => mockSyncStateGet(...args),
    },
  },
}))

vi.mock('./sync-store', () => ({
  useSyncStore: {
    getState: () => storeState,
  },
}))

vi.mock('@/lib/tenant-path', () => ({
  prefixTenantPath: (path: string, tenantSlug: string | null) =>
    tenantSlug ? path.replace('/admin/', `/tenants/${tenantSlug}/admin/`) : path,
}))

class MockEventSource {
  static instances: MockEventSource[] = []

  readonly url: string
  readonly withCredentials: boolean
  onerror: ((event: Event) => void) | null = null
  #listeners = new Map<string, Set<EventListener>>()
  close = vi.fn()

  constructor(url: string, init?: EventSourceInit) {
    this.url = url
    this.withCredentials = Boolean(init?.withCredentials)
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.#listeners.get(type) ?? new Set<EventListener>()
    listeners.add(listener)
    this.#listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener) {
    this.#listeners.get(type)?.delete(listener)
  }

  dispatch(type: string, data?: Record<string, unknown>) {
    const event = { type, data: data ? JSON.stringify(data) : undefined } as MessageEvent
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

const originalWindow = globalThis.window
const originalNavigator = globalThis.navigator
const originalLocalStorage = globalThis.localStorage
const originalEventSource = globalThis.EventSource
const originalLocation = globalThis.location

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('sync-scheduler SSE integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    MockEventSource.instances.length = 0

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })

    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:5173',
      },
    })

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    })

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi
          .fn()
          .mockImplementation((key: string) => (key === 'edgecms:active-tenant' ? 'acme' : null)),
      },
    })

    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: MockEventSource as unknown as typeof EventSource,
    })

    mockSync.mockResolvedValue({
      push: { synced: 0, conflicted: 0, failed: 0 },
      pull: { changesApplied: 0, newCursor: 0 },
    })
  })

  afterEach(async () => {
    vi.useRealTimers()

    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }

    if (originalNavigator === undefined) {
      Reflect.deleteProperty(globalThis, 'navigator')
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      })
    }

    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage')
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      })
    }

    if (originalEventSource === undefined) {
      Reflect.deleteProperty(globalThis, 'EventSource')
    } else {
      Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: originalEventSource,
      })
    }

    if (originalLocation === undefined) {
      Reflect.deleteProperty(globalThis, 'location')
    } else {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      })
    }
  })

  it('opens tenant-scoped SSE stream when scheduler starts', async () => {
    const { startSyncScheduler, stopSyncScheduler } = await import(
      `./sync-scheduler?bypass=${Date.now()}`
    )

    startSyncScheduler(60_000)

    expect(MockEventSource.instances.length).toBe(1)
    expect(MockEventSource.instances[0]?.url).toBe('/api/tenants/acme/admin/sync/stream')
    expect(MockEventSource.instances[0]?.withCredentials).toBe(true)

    stopSyncScheduler()
  })

  it('triggers sync quickly when SSE change event arrives', async () => {
    const { startSyncScheduler, stopSyncScheduler } = await import(
      `./sync-scheduler?bypass=${Date.now()}`
    )

    startSyncScheduler(60_000)
    const source = MockEventSource.instances[0]
    expect(source).toBeDefined()

    source?.dispatch('change', { type: 'change', timestamp: '2026-01-15T10:00:00.000Z' })
    vi.advanceTimersByTime(350)
    await flushPromises()

    expect(mockSync).toHaveBeenCalledTimes(1)

    stopSyncScheduler()
  })

  it('does not double-run initial sync across rapid stop/start cycles', async () => {
    const { startSyncScheduler, stopSyncScheduler } = await import(
      `./sync-scheduler?bypass=${Date.now()}`
    )

    startSyncScheduler(60_000)
    stopSyncScheduler()
    startSyncScheduler(60_000)

    vi.advanceTimersByTime(1_000)
    await flushPromises()

    expect(mockSync).toHaveBeenCalledTimes(1)

    stopSyncScheduler()
  })
})
