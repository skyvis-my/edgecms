import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'

describe('eden-client', () => {
  beforeEach(() => {
    localStorage.clear()
    // Clear the in-memory cachedTenantSlug that may persist from other tests
    window.dispatchEvent(new CustomEvent('edgecms:tenant-switch', { detail: { slug: null } }))
    document.cookie = 'csrf_token=; max-age=0; path=/'
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizeEdenResponse returns data for successful responses', async () => {
    const { normalizeEdenResponse } = await import('./eden-client')

    expect(
      normalizeEdenResponse<{ id: string }>({
        data: { id: '1' },
        error: null,
      })
    ).toEqual({ id: '1' })
  })

  it('normalizeEdenResponse throws for failed responses', async () => {
    const { normalizeEdenResponse } = await import('./eden-client')

    expect(() =>
      normalizeEdenResponse({
        data: null,
        error: { status: 400, message: 'bad' },
      })
    ).toThrow('bad')
  })

  it('normalizeEdenResponse throws when success payload is missing data', async () => {
    const { normalizeEdenResponse } = await import('./eden-client')

    expect(() =>
      normalizeEdenResponse({
        data: null,
        error: null,
      })
    ).toThrow('Eden response is missing data')
  })

  it('resolveApiBasePath points admin dev traffic to local worker API', async () => {
    const { resolveApiBasePath } = await import('./eden-client')

    expect(resolveApiBasePath('http://localhost:5173')).toBe('/api')
    expect(resolveApiBasePath('http://localhost:8787')).toBe('/api')
  })

  it('edenGet returns unwrapped envelope data', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true, data: [{ id: '1' }] })),
    })

    const { edenGet } = await import('./eden-client')
    const result = await edenGet<Array<{ id: string }>>('/admin/webhooks')

    expect(result).toEqual([{ id: '1' }])
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/admin/webhooks',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    )
  })

  it('edenGet preserves envelope siblings like meta for list responses', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          success: true,
          data: [{ id: '1' }],
          meta: { pagination: { total: 1, page: 1, perPage: 20, hasMore: false } },
        })
      ),
    })

    const { edenGet } = await import('./eden-client')
    const result = await edenGet<{
      data: Array<{ id: string }>
      meta: { pagination: { total: number; page: number; perPage: number; hasMore: boolean } }
    }>('/admin/entries')

    expect(result).toEqual({
      data: [{ id: '1' }],
      meta: { pagination: { total: 1, page: 1, perPage: 20, hasMore: false } },
    })
  })

  it('edenPost prefixes tenant path and sends request body', async () => {
    localStorage.setItem('edgecms:active-tenant', 'acme')
    document.cookie = 'csrf_token=token-1; path=/'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true, data: { ok: true } })),
    })

    const { edenPost } = await import('./eden-client')
    await edenPost('/admin/entries', { title: 'Hello' })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/tenants/acme/admin/entries',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Hello' }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-csrf-token': 'token-1',
        }),
      })
    )
  })

  it('edenPostMultipart sends FormData without forcing JSON content type', async () => {
    localStorage.setItem('edgecms:active-tenant', 'acme')
    document.cookie = 'csrf_token=token-1; path=/'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 201,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true, data: { id: 'asset-1' } })),
    })

    const { edenPostMultipart } = await import('./eden-client')
    const form = new FormData()
    form.set('file', new File(['hello'], 'hero.jpg', { type: 'image/jpeg' }))
    form.set('filename', 'marketing/hero.jpg')
    await edenPostMultipart('/admin/assets/upload', form)

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const init = fetchCall?.[1] as RequestInit | undefined
    const headers = init?.headers as Record<string, string> | undefined

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/tenants/acme/admin/assets/upload',
      expect.objectContaining({
        method: 'POST',
        body: form,
      })
    )
    expect(headers?.['x-csrf-token']).toBe('token-1')
    expect(headers?.['Content-Type']).toBeUndefined()
  })

  it('edenGet does not send csrf header for safe methods', async () => {
    localStorage.removeItem('edgecms:active-tenant')
    window.dispatchEvent(new CustomEvent('edgecms:tenant-switch', { detail: { slug: null } }))
    document.cookie = 'csrf_token=token-1; path=/'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true, data: [] })),
    })

    const { edenGet } = await import('./eden-client')
    await edenGet('/admin/webhooks')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/admin/webhooks',
      expect.not.objectContaining({
        headers: expect.objectContaining({
          'x-csrf-token': expect.any(String),
        }),
      })
    )
  })

  it('edenPost fetches csrf token when missing', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi
        .fn()
        .mockResolvedValue({ success: true, data: { csrfToken: 'server-signed-token' } }),
    })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true, data: { ok: true } })),
    })

    const { edenPost } = await import('./eden-client')
    await edenPost('/admin/entries', { title: 'Hello' })

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/csrf',
      expect.objectContaining({ method: 'GET', credentials: 'include' })
    )

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    const init = fetchCall?.[1] as RequestInit | undefined
    const headers = init?.headers as Record<string, string> | undefined

    expect(headers?.['x-csrf-token']).toBe('server-signed-token')
  })

  it('edenDelete returns null for 204 no-content responses', async () => {
    document.cookie = 'csrf_token=token-1; path=/'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
      text: vi.fn().mockResolvedValue(''),
    })

    const { edenDelete } = await import('./eden-client')
    await expect(edenDelete('/admin/webhooks/1')).resolves.toBeNull()
  })

  it('edenDelete returns null for 205 reset-content responses', async () => {
    document.cookie = 'csrf_token=token-1; path=/'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 205,
      text: vi.fn().mockResolvedValue(''),
    })

    const { edenDelete } = await import('./eden-client')
    await expect(edenDelete('/admin/webhooks/1')).resolves.toBeNull()
  })

  it('edenPut sends request body and returns non-envelope payload as-is', async () => {
    localStorage.removeItem('edgecms:active-tenant')
    window.dispatchEvent(new CustomEvent('edgecms:tenant-switch', { detail: { slug: null } }))
    document.cookie = 'csrf_token=token-1; path=/'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ id: '1', title: 'Hello' })),
    })

    const { edenPut } = await import('./eden-client')
    const result = await edenPut<{ id: string; title: string }>('/admin/entries/1', {
      title: 'Hello',
    })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/admin/entries/1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ title: 'Hello' }) })
    )
    expect(result).toEqual({ id: '1', title: 'Hello' })
  })

  it('throws ApiClientError fields from failed envelope', async () => {
    document.cookie = 'csrf_token=token-1; path=/'
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ success: false, error: { code: 'INVALID', message: 'bad payload' } })
        ),
    })

    const { edenPost } = await import('./eden-client')
    await expect(edenPost('/admin/webhooks', {})).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 422,
      code: 'INVALID',
      message: 'bad payload',
    })
  })

  it('throws ApiClientError with status text when non-envelope request fails', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      text: vi.fn().mockResolvedValue(JSON.stringify({ detail: 'boom' })),
    })

    const { edenGet } = await import('./eden-client')
    await expect(edenGet('/admin/failing')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 500,
      message: 'Server Error',
      body: { detail: 'boom' },
    })
  })

  it('throws envelope error even when HTTP status is ok', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ success: false, error: { code: 'DOMAIN_ERROR', message: 'Nope' } })
        ),
    })

    const { edenGet } = await import('./eden-client')
    await expect(edenGet('/admin/entries')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 200,
      code: 'DOMAIN_ERROR',
      message: 'Nope',
    })
  })
})
