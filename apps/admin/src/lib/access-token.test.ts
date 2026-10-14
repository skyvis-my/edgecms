import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  __resetAccessTokenCacheForTests,
  clearAccessTokens,
  ensureAccessToken,
  getCachedAccessToken,
} from './access-token'

function mintResponse(token: string, expiresAt: string) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ success: true, data: { token, expiresAt } }),
  }
}

describe('access-token manager', () => {
  beforeEach(() => {
    __resetAccessTokenCacheForTests()
    localStorage.clear()
    window.dispatchEvent(new CustomEvent('edgecms:tenant-switch', { detail: { slug: null } }))
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when nothing is cached', () => {
    expect(getCachedAccessToken('acme')).toBeNull()
  })

  it('mints and caches a tenant token', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mintResponse('tok-1', new Date(Date.now() + 10 * 60_000).toISOString())
    )
    const token = await ensureAccessToken('acme')
    expect(token).toBe('tok-1')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/auth/access-token?tenant=acme',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(getCachedAccessToken('acme')).toBe('tok-1')
    expect(getCachedAccessToken(null)).toBeNull()
  })

  it('deduplicates concurrent mints', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mintResponse('tok-1', new Date(Date.now() + 10 * 60_000).toISOString())
    )
    const [a, b] = await Promise.all([ensureAccessToken('acme'), ensureAccessToken('acme')])
    expect(a).toBe('tok-1')
    expect(b).toBe('tok-1')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('reuses a fresh token without fetching', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mintResponse('tok-1', new Date(Date.now() + 10 * 60_000).toISOString())
    )
    await ensureAccessToken('acme')
    await ensureAccessToken('acme')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('force refresh replaces the cached token', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      mintResponse('tok-1', new Date(Date.now() + 10 * 60_000).toISOString())
    )
    fetchMock.mockResolvedValueOnce(
      mintResponse('tok-2', new Date(Date.now() + 10 * 60_000).toISOString())
    )
    await ensureAccessToken('acme')
    const refreshed = await ensureAccessToken('acme', { force: true })
    expect(refreshed).toBe('tok-2')
    expect(getCachedAccessToken('acme')).toBe('tok-2')
  })

  it('returns null and keeps quiet when minting fails', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 401 })
    await expect(ensureAccessToken('acme')).resolves.toBeNull()
    expect(getCachedAccessToken('acme')).toBeNull()
  })

  it('treats near-expiry tokens as unusable for attach', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mintResponse('tok-1', new Date(Date.now() + 30_000).toISOString())
    )
    await ensureAccessToken('acme')
    expect(getCachedAccessToken('acme')).toBeNull()
  })

  it('clearAccessTokens drops one scope or everything', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(
      mintResponse('tok-1', new Date(Date.now() + 10 * 60_000).toISOString())
    )
    await ensureAccessToken('acme')
    await ensureAccessToken(null)
    clearAccessTokens('acme')
    expect(getCachedAccessToken('acme')).toBeNull()
    expect(getCachedAccessToken(null)).toBe('tok-1')
    clearAccessTokens()
    expect(getCachedAccessToken(null)).toBeNull()
  })
})

describe('eden-client access-token wiring', () => {
  beforeEach(() => {
    __resetAccessTokenCacheForTests()
    localStorage.clear()
    window.dispatchEvent(new CustomEvent('edgecms:tenant-switch', { detail: { slug: null } }))
    document.cookie = 'csrf_token=; max-age=0; path=/'
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('attaches a cached token as Bearer without extra fetches', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      mintResponse('tok-1', new Date(Date.now() + 10 * 60_000).toISOString())
    )
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true, data: [] })),
    })
    const { ensureAccessToken: ensure } = await import('./access-token')
    await ensure('acme')
    fetchMock.mockClear()

    localStorage.setItem('edgecms:active-tenant', 'acme')
    const { edenGet } = await import('./eden-client')
    await edenGet('/admin/webhooks')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tenants/acme/admin/webhooks',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
      })
    )
  })

  it('refreshes once and retries on TOKEN_STALE', async () => {
    localStorage.setItem('edgecms:active-tenant', 'acme')
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      mintResponse('tok-old', new Date(Date.now() + 10 * 60_000).toISOString())
    )
    const { ensureAccessToken: ensure } = await import('./access-token')
    await ensure('acme')

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ success: false, error: { code: 'TOKEN_STALE', message: 'stale' } })
        ),
    })
    fetchMock.mockResolvedValueOnce(
      mintResponse('tok-new', new Date(Date.now() + 10 * 60_000).toISOString())
    )
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true, data: [] })),
    })

    const { edenGet } = await import('./eden-client')
    const result = await edenGet<unknown[]>('/admin/webhooks')

    expect(result).toEqual([])
    const retryCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    expect(retryCall?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer tok-new' }),
    })
  })

  it('does not retry non-stale 401s', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'nope' } })
        ),
    })
    const { edenGet } = await import('./eden-client')
    await expect(edenGet('/admin/webhooks')).rejects.toThrow('nope')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
