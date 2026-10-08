import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockNavigate = vi.fn()
const mockSignUpEmail = vi.fn()
const mockRefreshSessionAfterLogin = vi.fn()
const mockResolveApiBasePath = vi.fn(() => '/api')

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@/lib/auth-client', () => ({
  signUp: {
    email: (...args: unknown[]) => mockSignUpEmail(...args),
  },
  refreshSessionAfterLogin: (...args: unknown[]) => mockRefreshSessionAfterLogin(...args),
}))

vi.mock('@/lib/eden-client', () => ({
  resolveApiBasePath: () => mockResolveApiBasePath(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

describe('SignUpForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignUpEmail.mockResolvedValue({ error: null })
    mockRefreshSessionAfterLogin.mockResolvedValue({ data: null, error: null })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { slug: 'acme' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    )
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses first and last name fields and submits full name', async () => {
    const user = userEvent.setup()
    const { SignUpForm } = await import(`./sign-up-form?bypass=${Date.now()}`)

    render(<SignUpForm />)

    await user.type(screen.getByLabelText('First Name'), 'John')
    await user.type(screen.getByLabelText('Last Name'), 'Doe')
    await user.type(screen.getByLabelText('Email'), 'john@example.com')
    await user.type(screen.getByLabelText('Password'), 'Password1')
    await user.type(screen.getByLabelText('Confirm Password'), 'Password1')

    await user.click(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => {
      expect(mockSignUpEmail).toHaveBeenCalledWith({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'Password1',
      })
    })
  })

  it('provisions a tenant during onboarding and stores active tenant slug', async () => {
    const user = userEvent.setup()
    const { SignUpForm } = await import(`./sign-up-form?bypass=${Date.now()}`)

    render(<SignUpForm onboarding />)

    await user.type(screen.getByLabelText('First Name'), 'Jane')
    await user.type(screen.getByLabelText('Last Name'), 'Doe')
    await user.type(screen.getByLabelText('Email'), 'jane@example.com')
    await user.type(screen.getByLabelText('Password'), 'Password1')
    await user.type(screen.getByLabelText('Confirm Password'), 'Password1')

    await user.click(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/bootstrap/provision-tenant', {
        method: 'POST',
        credentials: 'include',
      })
    })

    expect(localStorage.getItem('edgecms:active-tenant')).toBe('acme')
  })
})
