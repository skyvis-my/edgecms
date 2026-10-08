import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const resolveTenantSlugFromLocationMock = mock(() => null as string | null)
const recordTenantHistoryMock = mock(
  () => [] as Array<{ path: string; label: string; timestamp: string }>
)
const removeTenantHistoryItemMock = mock(
  () => [] as Array<{ path: string; label: string; timestamp: string }>
)
let mockPathname = '/collections'
let mockHistoryEntries: Array<{ path: string; label: string; timestamp: string }> = []

mock.module('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: mockPathname }),
  useNavigate: () => mock(() => {}),
}))

mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

mock.module('@/components/ui/sidebar', () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
    <button type='button'>{children}</button>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSidebar: () => ({ isMobile: false }),
}))

mock.module('../api', () => ({
  getCurrentTenantSlug: () => 'acme',
  setCurrentTenantSlug: mock(() => {}),
  useTenants: () => ({
    data: [{ id: '1', name: 'acme', slug: 'acme', status: 'active' }],
  }),
  // Preserve exports that other test files may need
  tenantsKeys: { all: ['tenants'], detail: (slug: string) => ['tenants', slug], current: ['tenant-current'] },
  tenantKeys: { all: ['tenants'], detail: (slug: string) => ['tenants', slug], current: ['tenant-current'] },
  TENANT_USER_ROLES: ['owner', 'admin', 'member'],
  useUpdateTenantUserRole: () => ({ mutateAsync: mock(() => {}), isPending: false }),
  useTenant: () => ({ data: null }),
  useCreateTenant: () => ({ mutateAsync: mock(() => {}) }),
  useUpdateTenant: () => ({ mutateAsync: mock(() => {}) }),
  useDeleteTenant: () => ({ mutateAsync: mock(() => {}) }),
  useInviteTenantUser: () => ({ mutateAsync: mock(() => {}) }),
  useRemoveTenantUser: () => ({ mutateAsync: mock(() => {}) }),
}))

mock.module('@/lib/tenant-route', () => ({
  buildTenantAdminUrl: (slug: string) => `/tenants/${slug}/collections`,
  buildTenantRedirectUrl: (path: string, slug: string) => `/tenants/${slug}${path}`,
  isTenantManagementPath: () => false,
  resolveTenantSlugFromLocation: resolveTenantSlugFromLocationMock,
}))

mock.module('./tenant-history', () => ({
  getTenantHistoryStorageKey: () => 'edgecms:tenant-history:acme',
  readTenantHistory: () => mockHistoryEntries,
  recordTenantHistory: (...args: unknown[]) => recordTenantHistoryMock(...args),
  removeTenantHistoryItem: (...args: unknown[]) => removeTenantHistoryItemMock(...args),
  buildHistoryLabel: (path: string) => path,
  resolveHistoryPathForTenant: (path: string, slug: string | null) =>
    slug ? `/tenants/${slug}${path}` : path,
  extractTenantSlugFromHistoryPath: () => null,
}))

const { TenantSwitcher } = await import('./tenant-switcher')

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('TenantSwitcher copy', () => {
  beforeEach(() => {
    mockPathname = '/collections'
    mockHistoryEntries = []
    recordTenantHistoryMock.mockReset()
    removeTenantHistoryItemMock.mockReset()
    recordTenantHistoryMock.mockImplementation(() => [])
    removeTenantHistoryItemMock.mockImplementation(() => [])
  })

  it('uses global wording when URL has no tenant slug', () => {
    resolveTenantSlugFromLocationMock.mockReturnValue(null)

    render(<TenantSwitcher />, { wrapper: createWrapper() })

    expect(screen.getByText('Global')).toBeInTheDocument()
    expect(screen.getByText('Tenants')).toBeInTheDocument()
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument()
    expect(screen.queryByText('Workspaces')).not.toBeInTheDocument()
  })

  it('uses tenant wording when URL includes tenant slug', () => {
    resolveTenantSlugFromLocationMock.mockReturnValue('acme')

    render(<TenantSwitcher />, { wrapper: createWrapper() })

    expect(screen.getAllByText('Tenant').length).toBeGreaterThan(0)
    expect(screen.getByText('Tenants')).toBeInTheDocument()
  })

  it('does not record current URL on first render, only when navigating away', () => {
    resolveTenantSlugFromLocationMock.mockReturnValue('acme')
    const { rerender } = render(<TenantSwitcher />, { wrapper: createWrapper() })

    expect(recordTenantHistoryMock).not.toHaveBeenCalled()

    mockPathname = '/entries'
    recordTenantHistoryMock.mockReturnValueOnce(mockHistoryEntries)
    rerender(<TenantSwitcher />)

    expect(recordTenantHistoryMock).toHaveBeenCalledTimes(1)
    expect(recordTenantHistoryMock.mock.calls[0]?.[1]).toBe('/collections')
  })

  it('shows a subtle current URL dot indicator without text', () => {
    resolveTenantSlugFromLocationMock.mockReturnValue('acme')
    mockHistoryEntries = [
      { path: '/tenants/acme/collections', label: 'Collections', timestamp: 'now' },
    ]
    render(<TenantSwitcher />, { wrapper: createWrapper() })

    expect(screen.getByTestId('current-history-dot')).toBeInTheDocument()
    expect(screen.queryByText('Current URL')).not.toBeInTheDocument()
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
  })

  it('shows hover clear control and removes an item when clicked', () => {
    resolveTenantSlugFromLocationMock.mockReturnValue('acme')
    mockHistoryEntries = [
      { path: '/tenants/acme/collections', label: 'Collections', timestamp: 'now' },
    ]
    removeTenantHistoryItemMock.mockReturnValueOnce([])

    render(<TenantSwitcher />, { wrapper: createWrapper() })
    fireEvent.click(screen.getByRole('button', { name: 'Clear history item Collections' }))

    expect(removeTenantHistoryItemMock).toHaveBeenCalled()
  })
})
