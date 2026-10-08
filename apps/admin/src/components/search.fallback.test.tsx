import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Search } from './search'

describe('Search fallback behavior', () => {
  it('renders and stays usable without SearchProvider', async () => {
    const user = userEvent.setup()
    render(<Search />)

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()

    await user.click(button)
    expect(button).toBeInTheDocument()
  })
})
