import '../../../../test-utils/setup'
import { afterEach, describe, expect, it } from 'bun:test'

const { cleanup, render, screen } = await import('@testing-library/react')
const { EntryStatusIndicator } = await import('./entry-status-indicator')

describe('EntryStatusIndicator', () => {
  afterEach(() => cleanup())

  it('exposes an accessible group name and hides decorative icons', () => {
    render(<EntryStatusIndicator status='published' />)
    const group = screen.getByRole('group', { name: 'Status: Published.' })
    expect(group).toBeInTheDocument()
    for (const svg of group.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
    expect(screen.getByText('Published')).toBeInTheDocument()
  })

  it('shows the scheduled publish time in a <time> element', () => {
    const at = '2026-12-01T09:00:00.000Z'
    render(<EntryStatusIndicator status='scheduled' publishAt={at} />)
    const time = screen.getByTestId('entry-status-schedule').querySelector('time')
    expect(time?.getAttribute('datetime')).toBe(at)
    expect(time?.textContent).toMatch(/^Publishes 2026-12-01/)
  })

  it('shows a queued marker with count for unsynced offline commands', () => {
    render(<EntryStatusIndicator status='draft' queue={{ pending: 2, conflicted: 0 }} />)
    expect(screen.getByTestId('entry-status-sync').textContent).toBe('Queued offline (2)')
    expect(screen.getByTestId('entry-status-indicator').getAttribute('data-sync')).toBe('queued')
    expect(
      screen.getByRole('group', { name: /2 changes queued offline, not yet synced/ })
    ).toBeInTheDocument()
  })

  it('shows Saved / Unsaved changes in the editor header', () => {
    const view = render(<EntryStatusIndicator variant='header' status='draft' showSaved />)
    expect(screen.getByTestId('entry-status-sync').textContent).toBe('Saved')
    view.rerender(
      <EntryStatusIndicator variant='header' status='draft' showSaved hasUnsavedChanges />
    )
    expect(screen.getByTestId('entry-status-sync').textContent).toBe('Unsaved changes')
  })

  it('uses no yellow or amber classes in any state', () => {
    const { container } = render(
      <>
        <EntryStatusIndicator status='archived' />
        <EntryStatusIndicator status='published' unpublishAt='2026-12-01T09:00:00.000Z' />
        <EntryStatusIndicator status='draft' queue={{ pending: 1, conflicted: 1 }} />
        <EntryStatusIndicator status='draft' hasUnsavedChanges />
      </>
    )
    expect(container.innerHTML).not.toMatch(/yellow|amber|orange/)
  })
})
