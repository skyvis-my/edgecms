import '../../../test-utils/setup'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { FileText, Folder } from 'lucide-react'
import * as React from 'react'

let mockLocationHref = '/dashboard'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode
    to: string
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useLocation: ({ select }: { select?: (location: { href: string }) => unknown } = {}) => {
    const loc = { href: mockLocationHref }
    return select ? select(loc) : loc
  },
}))

import { SidebarProvider } from '@/components/ui/sidebar'
import { NavGroup } from './nav-group'
import type { NavGroup as NavGroupProps } from './types'

describe('NavGroup Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocationHref = '/dashboard'
  })

  const testNavGroup: NavGroupProps = {
    title: 'Management',
    items: [
      {
        title: 'Dashboard',
        url: '/dashboard',
        icon: FileText,
        badge: 'New',
      },
      {
        title: 'Content',
        url: '/content',
        icon: Folder,
        items: [
          {
            title: 'Articles',
            url: '/content/articles',
            badge: '12',
          },
          {
            title: 'Categories',
            url: '/content/categories',
          },
        ],
      },
    ],
  }

  it('renders group title, direct links, and badges, and expands collapsible item on click', () => {
    render(
      <SidebarProvider defaultOpen={true}>
        <NavGroup {...testNavGroup} />
      </SidebarProvider>
    )

    expect(screen.getByText('Management')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()

    // Click collapsible trigger to expand subitems
    const contentTrigger = screen.getByRole('button', { name: /content/i })
    fireEvent.click(contentTrigger)

    expect(screen.getByText('Articles')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Categories')).toBeInTheDocument()
  })

  it('automatically opens collapsible item when child URL matches current href', () => {
    mockLocationHref = '/content/articles'
    render(
      <SidebarProvider defaultOpen={true}>
        <NavGroup {...testNavGroup} />
      </SidebarProvider>
    )

    expect(screen.getByText('Articles')).toBeInTheDocument()
  })

  it('renders collapsed dropdown menu when sidebar is collapsed', () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <NavGroup {...testNavGroup} />
      </SidebarProvider>
    )

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Content')).toBeInTheDocument()
  })
})
