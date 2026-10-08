import { describe, expect, it, vi } from 'bun:test'
import { render, screen } from '@testing-library/react'

// Dynamic import to bypass cache from other tests
const { Header } = await import(`./header?bypass=${Date.now()}`)

// Mock SidebarTrigger to avoid context issues and conflicts with other tests
vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: ({ className }: { className?: string }) => (
    <button type='button' data-testid='sidebar-trigger' className={className}>
      Toggle Sidebar
    </button>
  ),
  useSidebar: () => ({ state: 'expanded', toggleSidebar: vi.fn() }),
}))

// Mock Separator
vi.mock('@/components/ui/separator', () => ({
  Separator: ({ className }: { className?: string }) => (
    <div data-testid='separator' className={className} />
  ),
}))

describe('Header', () => {
  it('renders with sidebar trigger', () => {
    render(<Header>Header Content</Header>)

    expect(screen.getByTestId('sidebar-trigger')).toBeInTheDocument()
    expect(screen.getByText('Header Content')).toBeInTheDocument()
  })

  it('shows separator', () => {
    render(<Header>Header Content</Header>)

    expect(screen.getByTestId('separator')).toBeInTheDocument()
  })

  it('renders children', () => {
    render(
      <Header>
        <div data-testid='child'>Child</div>
      </Header>
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('renders as a header element', () => {
    const { container } = render(<Header>Content</Header>)

    const header = container.querySelector('header')
    expect(header).toBeInTheDocument()
  })

  it('applies fixed class when fixed prop is set', () => {
    const { container } = render(<Header fixed>Content</Header>)

    const header = container.querySelector('header')
    expect(header?.className).toContain('header-fixed')
  })

  it('applies custom className', () => {
    const { container } = render(<Header className='custom-class'>Content</Header>)

    const header = container.querySelector('header')
    expect(header?.className).toContain('custom-class')
  })

  it('applies reusable luxury motion class', () => {
    const { container } = render(<Header>Content</Header>)

    const header = container.querySelector('header')
    expect(header?.className).toContain('edge-luxury-header')
  })
})
