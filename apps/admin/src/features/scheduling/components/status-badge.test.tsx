import '../../../../test-utils/setup'
import { afterEach, describe, expect, it } from 'bun:test'

const { cleanup, render } = await import('@testing-library/react')
const { StatusBadge } = await import('./status-badge')

describe('StatusBadge', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders draft status badge', () => {
    const view = render(<StatusBadge status='draft' />)
    expect(view.getByText('Draft')).toBeTruthy()
  })

  it('renders published status badge', () => {
    const view = render(<StatusBadge status='published' />)
    expect(view.getByText('Published')).toBeTruthy()
  })

  it('renders archived status badge', () => {
    const view = render(<StatusBadge status='archived' />)
    expect(view.getByText('Archived')).toBeTruthy()
  })

  it('renders scheduled status badge with relative date', () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString()
    const view = render(<StatusBadge status='scheduled' scheduledDate={futureDate} />)
    expect(view.getByText('Scheduled')).toBeTruthy()
  })

  it('applies custom className', () => {
    const { container } = render(<StatusBadge status='draft' className='custom-badge-class' />)
    expect(container.querySelector('.custom-badge-class')).toBeTruthy()
  })
})
