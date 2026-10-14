import '../../../test-utils/setup'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import * as React from 'react'

const mockTenantSlug = vi.fn<() => string | null>(() => 'acme')
vi.mock('@/features/tenants/api', () => ({
  getCurrentTenantSlug: () => mockTenantSlug(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => () => {},
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
    asChild?: boolean
  }) => <div onClick={onClick}>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/sign-out-dialog', () => ({
  SignOutDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid='sign-out-dialog'>Sign Out Confirm</div> : null,
}))

import { SidebarProvider } from '@/components/ui/sidebar'
import { NavUser } from './nav-user'

describe('NavUser Component', () => {
  const defaultUser = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    avatar: 'https://example.com/avatar.png',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockTenantSlug.mockReturnValue('acme')
  })

  it('renders user button with avatar initials, name, and email', () => {
    render(
      <SidebarProvider>
        <NavUser user={defaultUser} />
      </SidebarProvider>
    )

    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0)
    expect(screen.getAllByText('jane@example.com').length).toBeGreaterThan(0)
    expect(screen.getAllByText('JD').length).toBeGreaterThan(0)
  })

  it('falls back to "U" when user name is empty or whitespace', () => {
    render(
      <SidebarProvider>
        <NavUser user={{ name: '   ', email: 'empty@example.com', avatar: '' }} />
      </SidebarProvider>
    )

    expect(screen.getAllByText('U').length).toBeGreaterThan(0)
  })

  it('renders menu items and tenant-scoped links', () => {
    mockTenantSlug.mockReturnValue('acme')
    render(
      <SidebarProvider>
        <NavUser user={defaultUser} />
      </SidebarProvider>
    )

    expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument()
    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.getByText('Billing')).toBeInTheDocument()
    expect(screen.getByText('Notifications')).toBeInTheDocument()
    expect(screen.getByText('Sign out')).toBeInTheDocument()
  })

  it('renders global links when no tenant is active', () => {
    mockTenantSlug.mockReturnValue(null)
    render(
      <SidebarProvider>
        <NavUser user={defaultUser} />
      </SidebarProvider>
    )

    const accountLink = screen.getByText('Account').closest('a')
    expect(accountLink?.getAttribute('href')).toBe('/settings/account')
  })

  it('triggers sign-out dialog when clicking Sign out', () => {
    render(
      <SidebarProvider>
        <NavUser user={defaultUser} />
      </SidebarProvider>
    )

    const signOutBtn = screen.getByText('Sign out')
    fireEvent.click(signOutBtn)

    expect(screen.getByTestId('sign-out-dialog')).toBeInTheDocument()
  })
})
