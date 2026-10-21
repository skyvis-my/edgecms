import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockNavigate = vi.fn()
const mockSignInEmail = vi.fn()
const mockRefreshSessionAfterLogin = vi.fn()
const mockToastError = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('@/lib/auth-client', () => ({
  signIn: { email: (...args: unknown[]) => mockSignInEmail(...args) },
  refreshSessionAfterLogin: (...args: unknown[]) => mockRefreshSessionAfterLogin(...args),
}))

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), success: vi.fn() },
}))

async function submit() {
  const user = userEvent.setup()
  const { UserAuthForm } = await import(`./user-auth-form?bypass=${Date.now()}`)
  render(<UserAuthForm redirectTo='/entries' />)
  await user.type(screen.getByLabelText('Email'), 'me@example.com')
  await user.type(screen.getByLabelText('Password'), 'Password1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('UserAuthForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefreshSessionAfterLogin.mockResolvedValue({ data: null, error: null })
  })

  it('sends users with two-factor enabled to the code screen', async () => {
    mockSignInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null })
    await submit()
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/otp',
        search: { redirect: '/entries' },
        replace: true,
      })
    )
    expect(mockRefreshSessionAfterLogin).not.toHaveBeenCalled()
  })

  it('signs straight in without two-factor', async () => {
    mockSignInEmail.mockResolvedValue({ data: { token: 't' }, error: null })
    await submit()
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/entries', replace: true })
    )
  })

  it('explains unverified email', async () => {
    mockSignInEmail.mockResolvedValue({ error: { code: 'EMAIL_NOT_VERIFIED', status: 403 } })
    await submit()
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Verify your email first. We sent you a new link.')
    )
  })
})
