import { render, screen } from '@testing-library/react'
import { TopNav } from './top-nav'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    href,
  }: {
    children: React.ReactNode
    className?: string
    href?: string
  }) => (
    <a className={className} href={href ?? '#'}>
      {children}
    </a>
  ),
}))

describe('TopNav', () => {
  it('labels the mobile menu trigger for assistive technologies', () => {
    render(
      <TopNav
        links={[
          {
            title: 'Dashboard',
            href: '/',
            isActive: true,
          },
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'Open navigation menu' })).toBeInTheDocument()
  })
})
