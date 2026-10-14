import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'

const mockSidebar = {
  open: true,
  setOpen: vi.fn(),
}

const mockDirection = {
  defaultDir: 'ltr',
  dir: 'ltr',
  setDir: vi.fn(),
  resetDir: vi.fn(),
}

const mockTheme = {
  defaultTheme: 'system',
  theme: 'system',
  setTheme: vi.fn(),
  resetTheme: vi.fn(),
}

const mockLayout = {
  defaultVariant: 'inset',
  variant: 'inset',
  setVariant: vi.fn(),
  defaultCollapsible: 'icon',
  collapsible: 'icon',
  setCollapsible: vi.fn(),
  resetLayout: vi.fn(),
}

vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => mockSidebar,
}))

vi.mock('@/context/direction-provider', () => ({
  useDirection: () => mockDirection,
}))

vi.mock('@/context/theme-provider', () => ({
  useTheme: () => mockTheme,
}))

vi.mock('@/context/layout-provider', () => ({
  useLayout: () => mockLayout,
}))

import { ConfigDrawer } from './config-drawer'

describe('ConfigDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSidebar.open = true
    mockDirection.dir = 'ltr'
    mockTheme.theme = 'system'
    mockLayout.variant = 'inset'
    mockLayout.collapsible = 'icon'
  })

  it('renders trigger button and opens settings sheet', () => {
    render(<ConfigDrawer />)
    const trigger = screen.getByLabelText('Open theme settings')
    expect(trigger).toBeDefined()

    fireEvent.click(trigger)
    expect(screen.getByText('Theme Settings')).toBeDefined()
    expect(screen.getByText('Theme')).toBeDefined()
    expect(screen.getAllByText('Sidebar').length).toBeGreaterThan(0)
    expect(screen.getByText('Layout')).toBeDefined()
    expect(screen.getByText('Direction')).toBeDefined()
  })

  it('resets all settings to default values when Reset button is clicked', () => {
    render(<ConfigDrawer />)
    fireEvent.click(screen.getByLabelText('Open theme settings'))

    const resetButton = screen.getByLabelText('Reset all settings to default values')
    fireEvent.click(resetButton)

    expect(mockSidebar.setOpen).toHaveBeenCalledWith(true)
    expect(mockDirection.resetDir).toHaveBeenCalledTimes(1)
    expect(mockTheme.resetTheme).toHaveBeenCalledTimes(1)
    expect(mockLayout.resetLayout).toHaveBeenCalledTimes(1)
  })

  it('shows section reset buttons when values differ from defaults and resets individual sections', () => {
    mockTheme.theme = 'dark'
    mockLayout.variant = 'floating'
    mockSidebar.open = false // layout will differ from 'default'
    mockDirection.dir = 'rtl'

    render(<ConfigDrawer />)
    fireEvent.click(screen.getByLabelText('Open theme settings'))

    const resetThemeBtn = screen.getByLabelText('Reset Theme')
    fireEvent.click(resetThemeBtn)
    expect(mockTheme.setTheme).toHaveBeenCalledWith('system')

    const resetSidebarBtn = screen.getByLabelText('Reset Sidebar')
    fireEvent.click(resetSidebarBtn)
    expect(mockLayout.setVariant).toHaveBeenCalledWith('inset')

    const resetLayoutBtn = screen.getByLabelText('Reset Layout')
    fireEvent.click(resetLayoutBtn)
    expect(mockSidebar.setOpen).toHaveBeenCalledWith(true)
    expect(mockLayout.setCollapsible).toHaveBeenCalledWith('icon')

    const resetDirBtn = screen.getByLabelText('Reset Direction')
    fireEvent.click(resetDirBtn)
    expect(mockDirection.setDir).toHaveBeenCalledWith('ltr')
  })
})
