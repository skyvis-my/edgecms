import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import * as React from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from './sidebar'

let mockIsMobile = false
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mockIsMobile,
}))

function TestSidebarConsumer() {
  const sidebar = useSidebar()
  return (
    <div>
      <span data-testid='state'>{sidebar.state}</span>
      <span data-testid='open'>{String(sidebar.open)}</span>
      <span data-testid='open-mobile'>{String(sidebar.openMobile)}</span>
      <span data-testid='is-mobile'>{String(sidebar.isMobile)}</span>
      <button onClick={sidebar.toggleSidebar} data-testid='toggle-btn'>
        Toggle
      </button>
      <button onClick={() => sidebar.setOpen(false)} data-testid='close-btn'>
        Close
      </button>
      <button onClick={() => sidebar.setOpenMobile(true)} data-testid='open-mobile-btn'>
        Open Mobile
      </button>
    </div>
  )
}

describe('sidebar components', () => {
  beforeEach(() => {
    mockIsMobile = false
    document.cookie = ''
    vi.clearAllMocks()
  })

  describe('useSidebar & SidebarProvider', () => {
    it('throws error when useSidebar is used outside SidebarProvider', () => {
      expect(() => {
        render(<TestSidebarConsumer />)
      }).toThrow('useSidebar must be used within a SidebarProvider.')
    })

    it('provides defaultOpen state and toggles via toggleSidebar', () => {
      render(
        <SidebarProvider defaultOpen={true}>
          <TestSidebarConsumer />
        </SidebarProvider>
      )

      expect(screen.getByTestId('state').textContent).toBe('expanded')
      expect(screen.getByTestId('open').textContent).toBe('true')
      expect(screen.getByTestId('is-mobile').textContent).toBe('false')

      fireEvent.click(screen.getByTestId('toggle-btn'))
      expect(screen.getByTestId('state').textContent).toBe('collapsed')
      expect(screen.getByTestId('open').textContent).toBe('false')
      expect(document.cookie).toContain('sidebar_state=false')

      fireEvent.click(screen.getByTestId('toggle-btn'))
      expect(screen.getByTestId('state').textContent).toBe('expanded')
      expect(screen.getByTestId('open').textContent).toBe('true')
      expect(document.cookie).toContain('sidebar_state=true')
    })

    it('supports controlled open and onOpenChange', () => {
      const onOpenChange = vi.fn()
      render(
        <SidebarProvider open={true} onOpenChange={onOpenChange}>
          <TestSidebarConsumer />
        </SidebarProvider>
      )

      expect(screen.getByTestId('open').textContent).toBe('true')

      fireEvent.click(screen.getByTestId('close-btn'))
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(document.cookie).toContain('sidebar_state=false')
    })

    it('toggles sidebar via keyboard shortcut (cmd+b / ctrl+b)', () => {
      render(
        <SidebarProvider defaultOpen={true}>
          <TestSidebarConsumer />
        </SidebarProvider>
      )

      expect(screen.getByTestId('open').textContent).toBe('true')

      // Meta + b
      fireEvent.keyDown(window, { key: 'b', metaKey: true })
      expect(screen.getByTestId('open').textContent).toBe('false')

      // Ctrl + b
      fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
      expect(screen.getByTestId('open').textContent).toBe('true')

      // Unrelated key or no modifier should not toggle
      fireEvent.keyDown(window, { key: 'b' })
      expect(screen.getByTestId('open').textContent).toBe('true')
      fireEvent.keyDown(window, { key: 'c', metaKey: true })
      expect(screen.getByTestId('open').textContent).toBe('true')
    })

    it('manages mobile state when isMobile is true', () => {
      mockIsMobile = true
      render(
        <SidebarProvider>
          <TestSidebarConsumer />
        </SidebarProvider>
      )

      expect(screen.getByTestId('is-mobile').textContent).toBe('true')
      expect(screen.getByTestId('open-mobile').textContent).toBe('false')

      fireEvent.click(screen.getByTestId('toggle-btn'))
      expect(screen.getByTestId('open-mobile').textContent).toBe('true')

      fireEvent.click(screen.getByTestId('toggle-btn'))
      expect(screen.getByTestId('open-mobile').textContent).toBe('false')

      fireEvent.click(screen.getByTestId('open-mobile-btn'))
      expect(screen.getByTestId('open-mobile').textContent).toBe('true')
    })
  })

  describe('Sidebar component', () => {
    it('renders uncollapsible sidebar when collapsible="none"', () => {
      render(
        <SidebarProvider>
          <Sidebar collapsible='none' className='custom-class'>
            <div>Sidebar Content</div>
          </Sidebar>
        </SidebarProvider>
      )

      const sidebarEl = screen.getByText('Sidebar Content').parentElement
      expect(sidebarEl).toHaveAttribute('data-slot', 'sidebar')
      expect(sidebarEl?.className).toContain('custom-class')
    })

    it('renders mobile sheet when isMobile is true', () => {
      mockIsMobile = true
      render(
        <SidebarProvider defaultOpen={true}>
          <Sidebar side='left'>
            <div>Mobile Nav Items</div>
          </Sidebar>
          <TestSidebarConsumer />
        </SidebarProvider>
      )

      // Open mobile sheet
      fireEvent.click(screen.getByTestId('open-mobile-btn'))
      expect(screen.getByText('Mobile Nav Items')).toBeInTheDocument()
      const mobileSheet = screen.getByText('Mobile Nav Items').closest('[data-mobile="true"]')
      expect(mobileSheet).toHaveAttribute('data-slot', 'sidebar')
      expect(mobileSheet).toHaveAttribute('data-sidebar', 'sidebar')
    })

    it('renders desktop sidebar with different variants and sides', () => {
      const { unmount } = render(
        <SidebarProvider defaultOpen={true}>
          <Sidebar variant='sidebar' side='left' collapsible='offcanvas'>
            <div>Main Menu</div>
          </Sidebar>
        </SidebarProvider>
      )

      const desktopSidebar = screen.getByText('Main Menu').closest('[data-slot="sidebar"]')
      expect(desktopSidebar?.getAttribute('data-variant')).toBe('sidebar')
      expect(desktopSidebar?.getAttribute('data-side')).toBe('left')
      expect(desktopSidebar?.getAttribute('data-state')).toBe('expanded')
      unmount()

      const { unmount: unmount2 } = render(
        <SidebarProvider open={false}>
          <Sidebar variant='floating' side='right' collapsible='icon'>
            <div>Floating Menu</div>
          </Sidebar>
        </SidebarProvider>
      )

      const floatingSidebar = screen.getByText('Floating Menu').closest('[data-slot="sidebar"]')
      expect(floatingSidebar?.getAttribute('data-variant')).toBe('floating')
      expect(floatingSidebar?.getAttribute('data-side')).toBe('right')
      expect(floatingSidebar?.getAttribute('data-state')).toBe('collapsed')
      expect(floatingSidebar?.getAttribute('data-collapsible')).toBe('icon')
      unmount2()

      render(
        <SidebarProvider open={false}>
          <Sidebar variant='inset' side='left' collapsible='icon'>
            <div>Inset Menu</div>
          </Sidebar>
        </SidebarProvider>
      )

      const insetSidebar = screen.getByText('Inset Menu').closest('[data-slot="sidebar"]')
      expect(insetSidebar?.getAttribute('data-variant')).toBe('inset')
    })
  })

  describe('Sidebar controls and subcomponents', () => {
    it('SidebarTrigger toggles sidebar and calls custom onClick', () => {
      const handleClick = vi.fn()
      render(
        <SidebarProvider defaultOpen={true}>
          <SidebarTrigger onClick={handleClick} className='custom-trigger' />
          <TestSidebarConsumer />
        </SidebarProvider>
      )

      const trigger = screen.getByRole('button', { name: /toggle sidebar/i })
      expect(trigger).toHaveAttribute('data-slot', 'sidebar-trigger')
      expect(trigger).toHaveAttribute('data-sidebar', 'trigger')
      expect(trigger.className).toContain('custom-trigger')

      fireEvent.click(trigger)
      expect(handleClick).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('open').textContent).toBe('false')
    })

    it('SidebarRail toggles sidebar on click', () => {
      render(
        <SidebarProvider defaultOpen={true}>
          <SidebarRail className='custom-rail' />
          <TestSidebarConsumer />
        </SidebarProvider>
      )

      const rail = screen.getByRole('button', { name: /toggle sidebar/i })
      expect(rail).toHaveAttribute('data-slot', 'sidebar-rail')
      expect(rail).toHaveAttribute('data-sidebar', 'rail')
      expect(rail.className).toContain('custom-rail')

      fireEvent.click(rail)
      expect(screen.getByTestId('open').textContent).toBe('false')
    })

    it('renders layout primitives: Inset, Input, Header, Footer, Separator, Content', () => {
      render(
        <SidebarProvider>
          <SidebarInset className='inset-cls' data-testid='inset'>
            <SidebarHeader className='header-cls' data-testid='header'>
              <SidebarInput placeholder='Search...' data-testid='input' />
            </SidebarHeader>
            <SidebarSeparator className='sep-cls' data-testid='sep' />
            <SidebarContent className='content-cls' data-testid='content'>
              Content area
            </SidebarContent>
            <SidebarFooter className='footer-cls' data-testid='footer'>
              Footer area
            </SidebarFooter>
          </SidebarInset>
        </SidebarProvider>
      )

      expect(screen.getByTestId('inset')).toHaveAttribute('data-slot', 'sidebar-inset')
      expect(screen.getByTestId('header')).toHaveAttribute('data-slot', 'sidebar-header')
      expect(screen.getByTestId('input')).toHaveAttribute('data-slot', 'sidebar-input')
      expect(screen.getByTestId('sep')).toHaveAttribute('data-slot', 'sidebar-separator')
      expect(screen.getByTestId('content')).toHaveAttribute('data-slot', 'sidebar-content')
      expect(screen.getByTestId('footer')).toHaveAttribute('data-slot', 'sidebar-footer')
    })

    it('renders SidebarGroup, SidebarGroupLabel, SidebarGroupAction, and SidebarGroupContent', () => {
      render(
        <SidebarProvider>
          <SidebarGroup data-testid='group'>
            <SidebarGroupLabel data-testid='label'>Projects</SidebarGroupLabel>
            <SidebarGroupLabel asChild data-testid='label-aschild'>
              <span>Span Label</span>
            </SidebarGroupLabel>
            <SidebarGroupAction aria-label='Add project' data-testid='action'>
              +
            </SidebarGroupAction>
            <SidebarGroupAction asChild data-testid='action-aschild'>
              <a href='/new'>New</a>
            </SidebarGroupAction>
            <SidebarGroupContent data-testid='group-content'>
              Group items
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarProvider>
      )

      expect(screen.getByTestId('group')).toHaveAttribute('data-slot', 'sidebar-group')
      expect(screen.getByTestId('label')).toHaveAttribute('data-slot', 'sidebar-group-label')
      expect(screen.getByTestId('label-aschild')).toHaveAttribute('data-slot', 'sidebar-group-label')
      expect(screen.getByTestId('action')).toHaveAttribute('data-slot', 'sidebar-group-action')
      expect(screen.getByTestId('action-aschild')).toHaveAttribute('data-slot', 'sidebar-group-action')
      expect(screen.getByTestId('group-content')).toHaveAttribute('data-slot', 'sidebar-group-content')
    })

    it('renders SidebarMenu, SidebarMenuItem, SidebarMenuBadge, SidebarMenuSkeleton', () => {
      render(
        <SidebarProvider>
          <SidebarMenu data-testid='menu'>
            <SidebarMenuItem data-testid='item'>
              <SidebarMenuBadge data-testid='badge'>12</SidebarMenuBadge>
            </SidebarMenuItem>
            <SidebarMenuSkeleton data-testid='skeleton-no-icon' />
            <SidebarMenuSkeleton showIcon data-testid='skeleton-icon' />
          </SidebarMenu>
        </SidebarProvider>
      )

      expect(screen.getByTestId('menu')).toHaveAttribute('data-slot', 'sidebar-menu')
      expect(screen.getByTestId('item')).toHaveAttribute('data-slot', 'sidebar-menu-item')
      expect(screen.getByTestId('badge')).toHaveAttribute('data-slot', 'sidebar-menu-badge')
      expect(screen.getByTestId('skeleton-no-icon')).toHaveAttribute('data-slot', 'sidebar-menu-skeleton')
      expect(screen.getByTestId('skeleton-icon')).toHaveAttribute('data-slot', 'sidebar-menu-skeleton')
      expect(screen.getByTestId('skeleton-icon').querySelector('[data-sidebar="menu-skeleton-icon"]')).toBeTruthy()
    })

    it('renders SidebarMenuButton variants, sizes, active state, asChild, and tooltips', () => {
      render(
        <SidebarProvider defaultOpen={false}>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                variant='outline'
                size='sm'
                isActive={true}
                tooltip='Quick Link'
                data-testid='btn-1'
              >
                Button 1
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                size='lg'
                tooltip={{ children: 'Complex Tooltip', side: 'left' }}
                data-testid='btn-2'
              >
                Button 2
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild data-testid='btn-aschild'>
                <a href='/dashboard'>Dashboard</a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarProvider>
      )

      const btn1 = screen.getByTestId('btn-1')
      expect(btn1).toHaveAttribute('data-slot', 'sidebar-menu-button')
      expect(btn1).toHaveAttribute('data-size', 'sm')
      expect(btn1).toHaveAttribute('data-active', 'true')

      const btn2 = screen.getByTestId('btn-2')
      expect(btn2).toHaveAttribute('data-size', 'lg')

      const asChildLink = screen.getByTestId('btn-aschild')
      expect(asChildLink.tagName).toBe('A')
      expect(asChildLink).toHaveAttribute('data-slot', 'sidebar-menu-button')
    })

    it('renders SidebarMenuAction with showOnHover and asChild', () => {
      render(
        <SidebarProvider>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuAction
                showOnHover
                aria-label='Settings'
                data-testid='action-hover'
              >
                ...
              </SidebarMenuAction>
              <SidebarMenuAction asChild data-testid='action-child'>
                <a href='/edit'>Edit</a>
              </SidebarMenuAction>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarProvider>
      )

      expect(screen.getByTestId('action-hover')).toHaveAttribute('data-slot', 'sidebar-menu-action')
      expect(screen.getByTestId('action-hover').className).toContain('md:opacity-0')
      expect(screen.getByTestId('action-child')).toHaveAttribute('data-slot', 'sidebar-menu-action')
      expect(screen.getByTestId('action-child').tagName).toBe('A')
    })

    it('renders SidebarMenuSub, SidebarMenuSubItem, and SidebarMenuSubButton', () => {
      render(
        <SidebarProvider>
          <SidebarMenuSub data-testid='sub'>
            <SidebarMenuSubItem data-testid='sub-item'>
              <SidebarMenuSubButton
                size='sm'
                isActive={true}
                data-testid='sub-btn-sm'
              >
                Sub 1
              </SidebarMenuSubButton>
              <SidebarMenuSubButton
                size='md'
                asChild
                data-testid='sub-btn-aschild'
              >
                <a href='/sub2'>Sub 2</a>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </SidebarProvider>
      )

      expect(screen.getByTestId('sub')).toHaveAttribute('data-slot', 'sidebar-menu-sub')
      expect(screen.getByTestId('sub-item')).toHaveAttribute('data-slot', 'sidebar-menu-sub-item')

      const subBtn = screen.getByTestId('sub-btn-sm')
      expect(subBtn).toHaveAttribute('data-slot', 'sidebar-menu-sub-button')
      expect(subBtn).toHaveAttribute('data-size', 'sm')
      expect(subBtn).toHaveAttribute('data-active', 'true')

      const subBtnChild = screen.getByTestId('sub-btn-aschild')
      expect(subBtnChild.tagName).toBe('A')
      expect(subBtnChild).toHaveAttribute('data-size', 'md')
    })
  })
})
