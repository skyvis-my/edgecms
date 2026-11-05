import '../../../../test-utils/setup'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { ReactNode } from 'react'

let mockPathname = '/tenants/acme/collections'
let mockGlobalRole = 'viewer'
let mockTenantRole: string | null = 'owner'
let mockApiPlugins: Array<{ name: string; status: string }> = []

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useLocation: ({ select }: { select?: (loc: { pathname: string; href: string }) => unknown } = {}) => {
    const loc = { pathname: mockPathname, href: mockPathname }
    return select ? select(loc) : loc
  },
}))

const edenGet = vi.fn(async () => mockApiPlugins)
vi.mock('@/lib/eden-client', () => ({
  edenGet,
  edenPatch: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  getSessionIfNeeded: vi.fn(async () => ({ data: { user: { role: mockGlobalRole } } })),
}))

vi.mock('@/lib/access-token', () => ({
  ensureAccessToken: vi.fn(async (tenantSlug: string | null) => {
    if (!tenantSlug || !mockTenantRole) return null
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return `${encode({ alg: 'HS256' })}.${encode({ trl: mockTenantRole, tsl: tenantSlug })}.sig`
  }),
}))

import { composeAdminContributions } from '@edgecms/plugin-sdk'
import { SidebarProvider } from '@/components/ui/sidebar'
import {
  LayoutPluginBanners,
  PluginContributionPage,
  PluginNavGroups,
  PluginPanelSlot,
} from './admin-contributions'
import type { AdminContributionCatalogEntry } from './types'

function BillingPage({ tenantSlug }: { tenantSlug: string | null }) {
  return <p>Billing for {tenantSlug}</p>
}

function UsagePanel() {
  return <p>Usage panel body</p>
}

function BrokenPanel(): ReactNode {
  throw new Error('boom')
}

const catalog: AdminContributionCatalogEntry[] = [
  {
    pluginName: 'host-plan',
    contributions: {
      navItems: [
        { id: 'billing', label: 'Billing', group: 'Host', access: 'tenant:manage', component: BillingPage },
        { id: 'ops', label: 'Ops console', access: 'superadmin', component: BillingPage },
        { id: 'status', label: 'Status', access: 'tenant:read', component: BillingPage },
      ],
      panels: [
        { id: 'usage', slot: 'dashboard', title: 'Plan usage', access: 'tenant:read', component: UsagePanel },
        { id: 'broken', slot: 'settings', title: 'Broken', access: 'tenant:read', component: BrokenPanel },
      ],
      banners: [
        {
          id: 'trial',
          tone: 'warning',
          message: 'Trial ends in 3 days.',
          access: 'tenant:manage',
          link: { label: 'Upgrade', href: 'https://billing.example.com/upgrade' },
        },
        { id: 'sticky', tone: 'info', message: 'Maintenance tonight.', access: 'tenant:read', dismissible: false },
      ],
    },
  },
  {
    pluginName: 'turned-off',
    contributions: {
      navItems: [{ id: 'page', label: 'Disabled page', access: 'tenant:read', component: BillingPage }],
    },
  },
]

const registry = composeAdminContributions(catalog)

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider defaultOpen>{ui}</SidebarProvider>
    </QueryClientProvider>
  )
}

describe('HS-10 admin contribution rendering', () => {
  beforeEach(() => {
    mockPathname = '/tenants/acme/collections'
    mockGlobalRole = 'viewer'
    mockTenantRole = 'owner'
    mockApiPlugins = [{ name: 'turned-off', status: 'disabled' }]
    localStorage.clear()
  })

  it('renders permitted nav items at derived plugin routes, grouped', async () => {
    renderWithProviders(<PluginNavGroups tenantSlug='acme' registry={registry} />)
    const link = await screen.findByRole('link', { name: /Billing/ })
    expect(link.getAttribute('href')).toBe('/tenants/acme/plugins/host-plan/billing')
    expect(screen.getByText('Host')).toBeTruthy()
    expect(edenGet).toHaveBeenCalledWith('/admin/plugins')
    // superadmin-only and API-disabled plugin items stay hidden.
    expect(screen.queryByText('Ops console')).toBeNull()
    await waitFor(() => expect(screen.queryByText('Disabled page')).toBeNull())
  })

  it('hides manage-level nav items from tenant members', async () => {
    mockTenantRole = 'member'
    renderWithProviders(<PluginNavGroups tenantSlug='acme' registry={registry} />)
    expect(await screen.findByText('Status')).toBeTruthy()
    expect(screen.queryByText('Billing')).toBeNull()
  })

  it('renders nothing outside a tenant workspace', () => {
    const { container } = renderWithProviders(<PluginNavGroups tenantSlug={null} registry={registry} />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('shows superadmin-only items to super-admins', async () => {
    mockGlobalRole = 'superadmin'
    mockTenantRole = null
    renderWithProviders(<PluginNavGroups tenantSlug='acme' registry={registry} />)
    expect(await screen.findByText('Ops console')).toBeTruthy()
  })

  it('renders the plugin page component with tenant props', async () => {
    renderWithProviders(
      <PluginContributionPage tenantSlug='acme' pluginName='host-plan' pageId='billing' registry={registry} />
    )
    expect(await screen.findByText('Billing for acme')).toBeTruthy()
  })

  it('refuses a plugin page the viewer cannot open', async () => {
    mockTenantRole = 'member'
    renderWithProviders(
      <PluginContributionPage tenantSlug='acme' pluginName='host-plan' pageId='billing' registry={registry} />
    )
    expect(await screen.findByText('Page not available')).toBeTruthy()
    expect(screen.queryByText('Billing for acme')).toBeNull()
  })

  it('renders panels for their slot only', async () => {
    renderWithProviders(<PluginPanelSlot slot='dashboard' tenantSlug={null} registry={registry} />)
    expect(await screen.findByText('Plan usage')).toBeTruthy()
    expect(screen.getByText('Usage panel body')).toBeTruthy()
    expect(screen.queryByText('Broken')).toBeNull()
  })

  it('contains a crashing panel instead of breaking the page', async () => {
    const originalError = console.error
    console.error = () => {}
    try {
      renderWithProviders(<PluginPanelSlot slot='settings' tenantSlug='acme' registry={registry} />)
      expect(await screen.findByText('This host-plan section could not load.')).toBeTruthy()
    } finally {
      console.error = originalError
    }
  })

  it('renders banners as text with a safe link and remembers dismissal', async () => {
    const view = renderWithProviders(<LayoutPluginBanners registry={registry} />)
    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('Trial ends in 3 days.')
    const link = screen.getByRole('link', { name: /Upgrade/ })
    expect(link.getAttribute('href')).toBe('https://billing.example.com/upgrade')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: Trial ends in 3 days.' }))
    expect(screen.queryByText(/Trial ends/)).toBeNull()
    // Non-dismissible banner has no dismiss control and stays.
    expect(screen.getByText('Maintenance tonight.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Maintenance/ })).toBeNull()

    view.unmount()
    renderWithProviders(<LayoutPluginBanners registry={registry} />)
    await screen.findByText('Maintenance tonight.')
    expect(screen.queryByText(/Trial ends/)).toBeNull()
  })

  it('hides banners from viewers without the access level', async () => {
    mockTenantRole = 'member'
    renderWithProviders(<LayoutPluginBanners registry={registry} />)
    await screen.findByText('Maintenance tonight.')
    expect(screen.queryByText(/Trial ends/)).toBeNull()
  })
})
