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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  return { wrapper, queryClient }
}

describe('tenants api hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('reads current tenant slug via query hook', async () => {
    const { useCurrentTenantSlug } = await import('./api')
    localStorage.setItem('edgecms:active-tenant', 'acme')

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCurrentTenantSlug(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBe('acme')
  })

  it('fetches tenants and tenant detail', async () => {
    const { useTenants, useTenant } = await import('./api')
    edenGet
      .mockResolvedValueOnce([{ id: 't1', slug: 'acme' }])
      .mockResolvedValueOnce({ id: 't1', slug: 'acme', users: [] })

    const { wrapper } = createWrapper()
    const list = renderHook(() => useTenants(), { wrapper })
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenCalledWith('/admin/tenants')

    const detail = renderHook(() => useTenant('acme'), { wrapper })
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenCalledWith('/admin/tenants/acme')
  })

  it('create/update/delete and user membership mutations invalidate proper keys', async () => {
    const {
      tenantKeys,
      useCreateTenant,
      useUpdateTenant,
      useDeleteTenant,
      useAddTenantUser,
      useRemoveTenantUser,
    } = await import('./api')

    edenPost
      .mockResolvedValueOnce({ id: 't1', slug: 'acme' })
      .mockResolvedValueOnce({ id: 'u1', role: 'member' })
    edenPut.mockResolvedValueOnce({ id: 't1', slug: 'acme' })
    edenDelete.mockResolvedValue(undefined)

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const createHook = renderHook(() => useCreateTenant(), { wrapper })
    await createHook.result.current.mutateAsync({ name: 'Acme', slug: 'acme' })
    expect(edenPost).toHaveBeenCalledWith('/admin/tenants', { name: 'Acme', slug: 'acme' })

    const updateHook = renderHook(() => useUpdateTenant(), { wrapper })
    await updateHook.result.current.mutateAsync({ slug: 'acme', input: { name: 'Acme 2' } })
    expect(edenPut).toHaveBeenCalledWith('/admin/tenants/acme', { name: 'Acme 2' })

    const deleteHook = renderHook(() => useDeleteTenant(), { wrapper })
    await deleteHook.result.current.mutateAsync('acme')
    expect(edenDelete).toHaveBeenCalledWith('/admin/tenants/acme')

    const addUserHook = renderHook(() => useAddTenantUser(), { wrapper })
    await addUserHook.result.current.mutateAsync({
      slug: 'acme',
      input: { userId: 'u1', role: 'member' },
    })
    expect(edenPost).toHaveBeenCalledWith('/admin/tenants/acme/users', {
      userId: 'u1',
      role: 'member',
    })

    const removeUserHook = renderHook(() => useRemoveTenantUser(), { wrapper })
    await removeUserHook.result.current.mutateAsync({ slug: 'acme', userId: 'u1' })
    expect(edenDelete).toHaveBeenCalledWith('/admin/tenants/acme/users/u1')

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: tenantKeys.all })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: tenantKeys.detail('acme') })
  })

  it('useUpdateTenantUserRole calls PUT and invalidates queries', async () => {
    const { tenantKeys, useUpdateTenantUserRole } = await import('./api')

    edenPut.mockResolvedValueOnce({ tenantId: 't1', userId: 'u1', role: 'admin' })

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const hook = renderHook(() => useUpdateTenantUserRole(), { wrapper })
    await hook.result.current.mutateAsync({ slug: 'acme', userId: 'u1', role: 'admin' })

    expect(edenPut).toHaveBeenCalledWith('/admin/tenants/acme/users/u1', { role: 'admin' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: tenantKeys.detail('acme') })
  })

  it('rejects superadmin when adding a tenant user', async () => {
    const { useAddTenantUser } = await import('./api')
    const { wrapper } = createWrapper()
    const addUserHook = renderHook(() => useAddTenantUser(), { wrapper })

    await expect(
      addUserHook.result.current.mutateAsync({
        slug: 'acme',
        input: { userId: 'u1', role: 'superadmin' },
      })
    ).rejects.toThrow('Invalid tenant role')

    expect(edenPost).not.toHaveBeenCalled()
  })

  it('queues delete mutation offline for sync replay', async () => {
    const { useDeleteTenant } = await import(`./api?bypass=${Date.now()}`)
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteTenant(), { wrapper })

    const originalOnLine = navigator.onLine
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })

    await result.current.mutateAsync('acme')

    expect(edenDelete).not.toHaveBeenCalled()
    expect(mockCommandQueueAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          type: 'httpMutation',
          payload: {
            method: 'DELETE',
            path: '/admin/tenants/acme',
            body: undefined,
          },
        }),
        status: 'pending',
      })
    )

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: originalOnLine })
  })
})
