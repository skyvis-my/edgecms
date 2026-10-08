import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PasswordInput } from './password-input'

describe('PasswordInput', () => {
  it('exposes an accessible name for the visibility toggle', async () => {
    const user = userEvent.setup()
    render(<PasswordInput aria-label='Password' />)

    const showButton = screen.getByRole('button', { name: 'Show password' })
    await user.click(showButton)

    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()
  })
})
