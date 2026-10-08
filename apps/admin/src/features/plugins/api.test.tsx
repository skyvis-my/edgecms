import '../../../test-utils/setup'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const edenGet = vi.fn()
const edenPatch = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenGet,
  edenPatch,
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  }
}

describe('plugins api hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches loaded, disabled, and blocked plugins from admin API', async () => {
    const { usePlugins } = await import(`./api?bypass=${Date.now()}`)
    edenGet.mockResolvedValueOnce([
      {
        name: 'audit-trace',
        enabled: true,
        hooks: ['beforeCommand', 'afterCommand', 'beforeAiCommand'],
        aiTools: ['pluginUpdateEntry'],
        routes: ['health'],
        adminRoutes: ['health'],
        publicRoutes: [],
        status: 'loaded',
        sandbox: 'trusted_catalog',
      },
      {
        name: 'seo-metadata',
        enabled: false,
        hooks: ['beforeCommand'],
        aiTools: ['pluginGenerateSeoMetadata'],
        routes: ['health'],
        adminRoutes: [],
        publicRoutes: [],
        status: 'disabled',
        sandbox: 'trusted_catalog',
      },
      {
        name: 'unknown-plugin',
        enabled: true,
        hooks: [],
        aiTools: [],
        routes: [],
        adminRoutes: [],
        publicRoutes: [],
        status: 'blocked',
        sandbox: 'trusted_catalog',
        reason: 'Plugin is not in trusted catalog and was not loaded',
      },
    ])

    const { wrapper } = createWrapper()
    const hook = renderHook(() => usePlugins(), { wrapper })

    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))
    expect(edenGet).toHaveBeenCalledWith('/admin/plugins')
    expect(hook.result.current.data).toEqual([
      {
        name: 'audit-trace',
        enabled: true,
        hooks: ['beforeCommand', 'afterCommand', 'beforeAiCommand'],
        aiTools: ['pluginUpdateEntry'],
        routes: ['health'],
        adminRoutes: ['health'],
        publicRoutes: [],
        status: 'loaded',
        sandbox: 'trusted_catalog',
      },
      {
        name: 'seo-metadata',
        enabled: false,
        hooks: ['beforeCommand'],
        aiTools: ['pluginGenerateSeoMetadata'],
        routes: ['health'],
        adminRoutes: [],
        publicRoutes: [],
        status: 'disabled',
        sandbox: 'trusted_catalog',
      },
      {
        name: 'unknown-plugin',
        enabled: true,
        hooks: [],
        aiTools: [],
        routes: [],
        adminRoutes: [],
        publicRoutes: [],
        status: 'blocked',
        sandbox: 'trusted_catalog',
        reason: 'Plugin is not in trusted catalog and was not loaded',
      },
    ])
  })

  it('optimistically toggles plugins and rolls back on failure', async () => {
    const { pluginsKeys, useTogglePlugin } = await import(`./api?bypass=${Date.now()}`)
    const { queryClient, wrapper } = createWrapper()
    queryClient.setQueryData(pluginsKeys.all, [
      {
        name: 'audit-trace',
        enabled: true,
        hooks: ['beforeCommand'],
        aiTools: [],
        routes: ['health'],
        adminRoutes: ['health'],
        publicRoutes: [],
        status: 'loaded',
        sandbox: 'trusted_catalog',
        adminMenu: [],
      },
    ])
    edenPatch.mockRejectedValueOnce(new Error('toggle failed'))

    const hook = renderHook(() => useTogglePlugin(), { wrapper })

    await act(async () => {
      hook.result.current.mutate({ pluginName: 'audit-trace', enabled: false })
    })

    await waitFor(() => expect(hook.result.current.isError).toBe(true))
    expect(edenPatch).toHaveBeenCalledWith('/admin/plugins/audit-trace', { enabled: false })
    expect(queryClient.getQueryData(pluginsKeys.all)).toEqual([
      {
        name: 'audit-trace',
        enabled: true,
        hooks: ['beforeCommand'],
        aiTools: [],
        routes: ['health'],
        adminRoutes: ['health'],
        publicRoutes: [],
        status: 'loaded',
        sandbox: 'trusted_catalog',
        adminMenu: [],
      },
    ])
  })
})
