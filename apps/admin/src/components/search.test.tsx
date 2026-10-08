import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { Search } from './search'

const setOpen = vi.fn()

vi.mock('@/context/search-provider', () => ({
  useOptionalSearch: () => ({ setOpen }),
}))

describe('Search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders placeholder and keyboard hint', () => {
    render(<Search placeholder='Find entries' />)

    expect(screen.getByText('Find entries')).toBeInTheDocument()
    expect(screen.getByText('K')).toBeInTheDocument()
  })

  it('opens command search on click', () => {
    render(<Search />)

    fireEvent.click(screen.getByRole('button'))
    expect(setOpen).toHaveBeenCalledWith(true)
  })
})
