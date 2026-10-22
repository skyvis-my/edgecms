import '../../../test-utils/setup'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import * as React from 'react'

let mockPathname = '/tenants/tenant-1'
let mockCollectionsData: Array<{
  id: string
  name: string
  slug: string
  singleton?: boolean
}> = []
let mockIsLoadingCollections = false

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useLocation: ({ select }: { select?: (loc: { pathname: string; href: string }) => unknown } = {}) => {
    const loc = { pathname: mockPathname, href: mockPathname }
    return select ? select(loc) : loc
  },
  useNavigate: () => () => {},
}))

vi.mock('@/context/layout-provider', () => ({
  useLayout: () => ({ collapsible: 'icon', variant: 'sidebar' }),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: {
      user: {
        name: 'Sarah Connor',
        email: 'sarah@example.com',
      },
    },
  }),
}))

const mockUseCollections = vi.fn((_options?: { enabled?: boolean }) => ({
  data: mockCollectionsData,
  isLoading: mockIsLoadingCollections,
}))

vi.mock('@/features/collections/api/collections-api', () => ({
  useCollections: (options?: { enabled?: boolean }) => mockUseCollections(options),
}))

vi.mock('@/features/tenants/components/tenant-switcher', () => ({
  TenantSwitcher: () => <div data-testid='tenant-switcher'>Tenant Switcher</div>,
}))

import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from './app-sidebar'

describe('AppSidebar Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPathname = '/tenants/tenant-1'
    mockIsLoadingCollections = false
    mockCollectionsData = [
      { id: 'c1', name: 'Blog Posts', slug: 'posts', singleton: false },
      { id: 'c2', name: 'Site Settings', slug: 'site-settings', singleton: true },
    ]
  })

  it('renders tenant switcher, collection list, and singleton badge when tenant is active', () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <AppSidebar />
      </SidebarProvider>
    )

    expect(screen.getByTestId('tenant-switcher')).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()
    expect(screen.getByText('Blog Posts')).toBeInTheDocument()
    expect(screen.getByText('Site Settings')).toBeInTheDocument()
    expect(screen.getByText('singleton')).toBeInTheDocument()
  })

  it('renders loading indicator while collections are being fetched', () => {
    mockIsLoadingCollections = true
    render(
      <SidebarProvider defaultOpen={true}>
        <AppSidebar />
      </SidebarProvider>
    )

    expect(screen.getByText('Loading content...')).toBeInTheDocument()
  })

  it('filters collections by search text', async () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <AppSidebar />
      </SidebarProvider>
    )

    const searchInput = screen.getByLabelText('Filter collections')
    fireEvent.change(searchInput, { target: { value: 'Blog' } })

    await waitFor(() => {
      expect(screen.getByText('Blog Posts')).toBeInTheDocument()
      expect(screen.queryByText('Site Settings')).not.toBeInTheDocument()
    })

    fireEvent.change(searchInput, { target: { value: 'Nonexistent' } })
    await waitFor(() => {
      expect(screen.getByText('No content found')).toBeInTheDocument()
    })
  })

  it('hides Content section when no tenant is active in pathname', () => {
    mockPathname = '/admin'
    render(
      <SidebarProvider defaultOpen={true}>
        <AppSidebar />
      </SidebarProvider>
    )

    expect(screen.queryByText('Content')).not.toBeInTheDocument()
  })

  it('only fetches collections when a tenant is active in pathname', () => {
    mockPathname = '/'
    const { unmount } = render(
      <SidebarProvider defaultOpen={true}>
        <AppSidebar />
      </SidebarProvider>
    )
    expect(mockUseCollections).toHaveBeenLastCalledWith({ enabled: false })
    unmount()

    mockPathname = '/tenants/tenant-1'
    render(
      <SidebarProvider defaultOpen={true}>
        <AppSidebar />
      </SidebarProvider>
    )
    expect(mockUseCollections).toHaveBeenLastCalledWith({ enabled: true })
  })
})
