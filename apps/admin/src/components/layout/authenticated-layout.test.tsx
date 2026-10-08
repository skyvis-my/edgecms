import { render, screen } from '@testing-library/react'
import { AuthenticatedLayout } from './authenticated-layout'

// Mock all the provider dependencies to keep the test isolated
vi.mock('@tanstack/react-router', () => {
  return {
    Outlet: () => <div data-testid='outlet'>Outlet Content</div>,
  }
})

vi.mock('@/components/layout/app-sidebar', () => ({
  AppSidebar: () => <nav data-testid='app-sidebar'>Sidebar</nav>,
}))

vi.mock('@/components/skip-to-main', () => ({
  SkipToMain: () => (
    <a href='#main-content' data-testid='skip-to-main'>
      Skip to main
    </a>
  ),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarInset: ({ children, ...props }: { children: React.ReactNode; className?: string }) => (
    <div data-testid='sidebar-inset' {...props}>
      {children}
    </div>
  ),
  SidebarProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='sidebar-provider'>{children}</div>
  ),
}))

vi.mock('@/context/layout-provider', () => ({
  LayoutProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='layout-provider'>{children}</div>
  ),
}))

vi.mock('@/context/search-provider', () => ({
  SearchProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='search-provider'>{children}</div>
  ),
}))

vi.mock('@/features/sync/sync-provider', () => ({
  SyncProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='sync-provider'>{children}</div>
  ),
}))

vi.mock('@/lib/cookies', () => ({
  getCookie: vi.fn().mockReturnValue(undefined),
}))

describe('AuthenticatedLayout', () => {
  it('renders sidebar and main content area', () => {
    render(<AuthenticatedLayout />)

    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-inset')).toBeInTheDocument()
  })

  it('renders the Outlet when no children passed', () => {
    render(<AuthenticatedLayout />)

    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('renders children when provided', () => {
    render(
      <AuthenticatedLayout>
        <div data-testid='child-content'>Page Content</div>
      </AuthenticatedLayout>
    )

    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    expect(screen.getByText('Page Content')).toBeInTheDocument()
  })

  it('wraps content in required providers', () => {
    render(<AuthenticatedLayout />)

    expect(screen.getByTestId('sync-provider')).toBeInTheDocument()
    expect(screen.getByTestId('search-provider')).toBeInTheDocument()
    expect(screen.getByTestId('layout-provider')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-provider')).toBeInTheDocument()
  })

  it('renders SkipToMain accessibility component', () => {
    render(<AuthenticatedLayout />)

    expect(screen.getByTestId('skip-to-main')).toBeInTheDocument()
  })
})
