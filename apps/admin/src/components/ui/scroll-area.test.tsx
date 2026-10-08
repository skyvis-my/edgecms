import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'bun:test'
import { ScrollArea, ScrollBar } from './scroll-area'

vi.mock('@radix-ui/react-scroll-area', () => ({
  Root: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  Viewport: ({ children, ...props }: any) => (
    <div {...props}>{children}</div>
  ),
  ScrollAreaScrollbar: ({ children, orientation, ...props }: any) => (
    <div data-orientation={orientation} {...props}>
      {children}
    </div>
  ),
  ScrollAreaThumb: (props: any) => <div {...props} />,
  Corner: (props: any) => <div {...props} />,
}))

describe('ScrollArea wrappers', () => {
  it('renders root, viewport, and default vertical scrollbar slots', () => {
    const { container } = render(<ScrollArea>Content</ScrollArea>)

    expect(screen.getByText('Content')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="scroll-area"]')).toBeTruthy()
    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toBeTruthy()

    const scrollbar = container.querySelector('[data-slot="scroll-area-scrollbar"]')
    expect(scrollbar).toBeTruthy()
    expect(scrollbar?.getAttribute('data-orientation')).toBe('vertical')
  })

  it('supports horizontal orientation on both root viewport and scrollbar', () => {
    const { container } = render(<ScrollArea orientation='horizontal'>Wide</ScrollArea>)

    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')
    const scrollbar = container.querySelector('[data-slot="scroll-area-scrollbar"]')

    expect(viewport?.className).toContain('overflow-x-auto!')
    expect(scrollbar?.getAttribute('data-orientation')).toBe('horizontal')
  })

  it('renders standalone ScrollBar with thumb slot', () => {
    const { container } = render(
      <div>
        <ScrollBar orientation='horizontal' />
      </div>
    )

    expect(container.querySelector('[data-slot="scroll-area-thumb"]')).toBeTruthy()
  })
})
