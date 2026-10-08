import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const edenGet = vi.fn()
const edenPost = vi.fn()
const edenPut = vi.fn()
const edenDelete = vi.fn()
const mockCommandQueueAdd = vi.fn().mockResolvedValue(1)

vi.mock('@/lib/eden-client', () => ({
  edenGet,
  edenPost,
  edenPut,
  edenDelete,
}))

vi.mock('@/features/sync/offline-http-queue', () => ({
  canQueueOfflineMutation: () => true,
}))

vi.mock('@/features/sync/local-db', () => ({
  db: {
    commandQueue: {
      add: (...args: unknown[]) => mockCommandQueueAdd(...args),
      where: vi.fn().mockReturnValue({
        equals: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(0),
        }),
      }),
    },
  },
}))

vi.mock('@/features/sync/sync-store', () => ({
  useSyncStore: {
    getState: () => ({
      refreshCounts: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

vi.mock('@/lib/tenant-storage', () => ({
  getCurrentTenantSlug: () => 'test-tenant',
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  return { wrapper, queryClient }
}

describe('webhooks api hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  })

  it('fetches webhooks, detail, and deliveries', async () => {
    const { useWebhooks, useWebhook, useWebhookDeliveries } = await import(
      `./api?bypass=${Date.now()}`
    )

    edenGet
      .mockResolvedValueOnce([{ id: 'w1' }])
      .mockResolvedValueOnce({ id: 'w1', url: 'https://example.com' })
      .mockResolvedValueOnce([{ id: 'd1', webhookId: 'w1' }])

    const { wrapper } = createWrapper()

    const list = renderHook(() => useWebhooks(), { wrapper })
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenCalledWith('/admin/webhooks')

    const detail = renderHook(() => useWebhook('w1'), { wrapper })
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenCalledWith('/admin/webhooks/w1')

    const deliveries = renderHook(() => useWebhookDeliveries('w1'), { wrapper })
    await waitFor(() => expect(deliveries.result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenCalledWith('/admin/webhooks/w1/deliveries')
  })

  it('create/update/delete/test mutations call API and invalidate keys', async () => {
    const { webhooksKeys, useCreateWebhook, useUpdateWebhook, useDeleteWebhook, useTestWebhook } =
      await import(`./api?bypass=${Date.now()}`)

    edenPost
      .mockResolvedValueOnce({ id: 'w1', url: 'https://example.com' })
      .mockResolvedValueOnce({ statusCode: 200, body: 'ok', success: true })
    edenPut.mockResolvedValueOnce({ id: 'w1', url: 'https://example.com/2' })
    edenDelete.mockResolvedValueOnce(undefined)

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const createHook = renderHook(() => useCreateWebhook(), { wrapper })
    await createHook.result.current.mutateAsync({
      url: 'https://example.com',
      events: ['entry.created'],
    })
    expect(edenPost).toHaveBeenCalledWith('/admin/webhooks', {
      url: 'https://example.com',
      events: ['entry.created'],
    })

    const updateHook = renderHook(() => useUpdateWebhook(), { wrapper })
    await updateHook.result.current.mutateAsync({ id: 'w1', input: { status: 'disabled' } })
    expect(edenPut).toHaveBeenCalledWith('/admin/webhooks/w1', { status: 'disabled' })

    const deleteHook = renderHook(() => useDeleteWebhook(), { wrapper })
    await deleteHook.result.current.mutateAsync('w1')
    expect(edenDelete).toHaveBeenCalledWith('/admin/webhooks/w1')

    const testHook = renderHook(() => useTestWebhook(), { wrapper })
    await testHook.result.current.mutateAsync('w1')
    expect(edenPost).toHaveBeenCalledWith('/admin/webhooks/w1/test', {})

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: webhooksKeys.all })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: webhooksKeys.detail('w1') })
  })

  it('queues update mutation offline for sync replay', async () => {
    const { useUpdateWebhook } = await import(`./api?bypass=${Date.now()}`)
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateWebhook(), { wrapper })

    const originalOnLine = navigator.onLine
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })

    await result.current.mutateAsync({ id: 'w1', input: { status: 'disabled' } })

    expect(edenPut).not.toHaveBeenCalled()
    expect(mockCommandQueueAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          type: 'httpMutation',
          payload: {
            method: 'PUT',
            path: '/admin/webhooks/w1',
            body: { status: 'disabled' },
          },
        }),
        status: 'pending',
      })
    )

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: originalOnLine })
  })
})
