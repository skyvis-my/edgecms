import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockNavigate = vi.fn()
const mockVerifyTotp = vi.fn()
const mockVerifyBackupCode = vi.fn()
const mockRefreshSessionAfterLogin = vi.fn()
const mockToastError = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@/lib/auth-client', () => ({
  twoFactor: {
    verifyTotp: (...args: unknown[]) => mockVerifyTotp(...args),
    verifyBackupCode: (...args: unknown[]) => mockVerifyBackupCode(...args),
  },
  refreshSessionAfterLogin: (...args: unknown[]) => mockRefreshSessionAfterLogin(...args),
}))

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: vi.fn(),
  },
}))

// input-otp measures layout with elementFromPoint, which JSDOM does not implement.
beforeAll(() => {
  document.elementFromPoint ??= () => null
})

describe('OtpForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyTotp.mockResolvedValue({ data: {}, error: null })
    mockVerifyBackupCode.mockResolvedValue({ data: {}, error: null })
    mockRefreshSessionAfterLogin.mockResolvedValue({ data: null, error: null })
  })

  it('verifies the authenticator code and continues to the requested page', async () => {
    const user = userEvent.setup()
    const { OtpForm } = await import(`./otp-form?bypass=${Date.now()}`)
    render(<OtpForm mode='totp' redirectTo='/tenants/acme' />)

    await user.type(screen.getByLabelText('Authentication code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(mockVerifyTotp).toHaveBeenCalledWith({ code: '123456' }))
    expect(mockRefreshSessionAfterLogin).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/tenants/acme', replace: true })
  })

  it('uses a recovery code in recovery mode', async () => {
    const user = userEvent.setup()
    const { OtpForm } = await import(`./otp-form?bypass=${Date.now()}`)
    render(<OtpForm mode='recovery' />)

    await user.type(screen.getByLabelText('Recovery code'), ' abcde-12345 ')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(mockVerifyBackupCode).toHaveBeenCalledWith({ code: 'abcde-12345' }))
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('stays on the page when the code is wrong', async () => {
    mockVerifyTotp.mockResolvedValue({ error: { code: 'INVALID_CODE', message: 'Invalid code' } })
    const user = userEvent.setup()
    const { OtpForm } = await import(`./otp-form?bypass=${Date.now()}`)
    render(<OtpForm mode='totp' />)

    await user.type(screen.getByLabelText('Authentication code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalled())
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockRefreshSessionAfterLogin).not.toHaveBeenCalled()
  })

  it('only redirects to same-origin paths', async () => {
    const { safeRedirectPath } = await import(`./otp-form?bypass=${Date.now()}`)
    expect(safeRedirectPath('/entries')).toBe('/entries')
    expect(safeRedirectPath('//evil.example')).toBe('/')
    expect(safeRedirectPath('https://evil.example')).toBe('/')
    expect(safeRedirectPath(undefined)).toBe('/')
  })
})
