import { describe, expect, it } from 'vitest'

// Use cache-busted dynamic import to avoid cross-file mock contamination
// (tenant-switcher.test.tsx uses mock.module('./tenant-history') which persists globally)
const {
  buildHistoryLabel,
  extractTenantSlugFromHistoryPath,
  getTenantHistoryStorageKey,
  removeTenantHistoryItem,
  readTenantHistory,
  recordTenantHistory,
} = await import(`./tenant-history?_t=${Date.now()}`)

function createMemoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}

describe('tenant-history', () => {
  it('creates tenant-aware storage keys', () => {
    expect(getTenantHistoryStorageKey('acme')).toBe('edgecms:tenant-history:acme')
    expect(getTenantHistoryStorageKey(null)).toBe('edgecms:tenant-history:global')
  })

  it('builds readable labels from route paths', () => {
    expect(buildHistoryLabel('/')).toBe('Dashboard')
    expect(buildHistoryLabel('/collections/create-singleton')).toBe('Create Singleton')
    expect(buildHistoryLabel('/tenants/acme/admin/webhooks')).toBe('Webhooks')
    expect(buildHistoryLabel('/acme/collections')).toBe('Collections')
  })

  it('extracts tenant slug from history paths', () => {
    expect(extractTenantSlugFromHistoryPath('/acme/collections')).toBe('acme')
    expect(extractTenantSlugFromHistoryPath('/tenants/acme/collections')).toBe('acme')
    expect(extractTenantSlugFromHistoryPath('/collections')).toBeNull()
  })

  it('records the latest 5 unique history entries', () => {
    const storage = createMemoryStorage()
    const key = 'edgecms:tenant-history:acme'

    recordTenantHistory(key, '/collections', storage)
    recordTenantHistory(key, '/entries', storage)
    recordTenantHistory(key, '/webhooks', storage)
    recordTenantHistory(key, '/sync', storage)
    recordTenantHistory(key, '/publishing', storage)
    recordTenantHistory(key, '/settings', storage)
    recordTenantHistory(key, '/collections', storage)

    const history = readTenantHistory(key, storage)
    expect(history.length).toBe(5)
    expect(history[0]?.path).toBe('/collections')
    expect(history.map((item) => item.path)).not.toContain('/entries')
  })

  it('records tenant-scoped history urls for global recent history', () => {
    const storage = createMemoryStorage()
    const key = 'edgecms:tenant-history:acme'

    recordTenantHistory(key, '/collections', storage, 'acme')

    const history = readTenantHistory(key, storage)
    expect(history[0]?.path).toBe('/tenants/acme/collections')
  })

  it('normalizes legacy tenant history paths to canonical tenant routes', () => {
    const storage = createMemoryStorage()
    const key = 'edgecms:tenant-history:acme'

    storage.setItem(
      key,
      JSON.stringify([{ path: '/acme/collections', label: 'Collections', timestamp: 'now' }])
    )

    const history = readTenantHistory(key, storage)
    expect(history[0]?.path).toBe('/tenants/acme/collections')
  })

  it('removes a history item and persists remaining entries', () => {
    const storage = createMemoryStorage()
    const key = 'edgecms:tenant-history:acme'

    recordTenantHistory(key, '/collections', storage)
    recordTenantHistory(key, '/entries', storage)

    const next = removeTenantHistoryItem(key, '/entries', storage)
    expect(next.map((item) => item.path)).toEqual(['/collections'])
    expect(readTenantHistory(key, storage).map((item) => item.path)).toEqual(['/collections'])
  })
})
