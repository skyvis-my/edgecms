import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockEnable = vi.fn()
const mockVerifyTotp = vi.fn()
const mockDisable = vi.fn()
const mockRefreshSessionAfterLogin = vi.fn()
let mockSession: { user: { twoFactorEnabled?: boolean } } | null = { user: { twoFactorEnabled: false } }

vi.mock('@/lib/auth-client', () => ({
  twoFactor: {
    enable: (...args: unknown[]) => mockEnable(...args),
    verifyTotp: (...args: unknown[]) => mockVerifyTotp(...args),
    disable: (...args: unknown[]) => mockDisable(...args),
  },
  useSession: () => ({ data: mockSession, isPending: false }),
  refreshSessionAfterLogin: (...args: unknown[]) => mockRefreshSessionAfterLogin(...args),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const TOTP_URI = 'otpauth://totp/EdgeCMS:me%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=EdgeCMS'

// input-otp measures layout with elementFromPoint, which JSDOM does not implement.
beforeAll(() => {
  document.elementFromPoint ??= () => null
})

describe('TwoFactorSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession = { user: { twoFactorEnabled: false } }
    mockEnable.mockResolvedValue({
      data: { totpURI: TOTP_URI, backupCodes: ['aaaaa-11111', 'bbbbb-22222'] },
      error: null,
    })
    mockVerifyTotp.mockResolvedValue({ data: {}, error: null })
    mockDisable.mockResolvedValue({ data: { status: true }, error: null })
  })

  it('enrols: password, QR + key, code, then recovery codes', async () => {
    const user = userEvent.setup()
    const { TwoFactorSettings } = await import(`./two-factor-settings?bypass=${Date.now()}`)
    render(<TwoFactorSettings />)

    expect(screen.getByText('Off')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Set up' }))
    await user.type(screen.getByLabelText('Password'), 'Password1')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(mockEnable).toHaveBeenCalledWith({ password: 'Password1' }))
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeTruthy()
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy()

    await user.type(screen.getByLabelText('Authentication code'), '654321')
    await user.click(screen.getByRole('button', { name: 'Verify and turn on' }))

    await waitFor(() => expect(mockVerifyTotp).toHaveBeenCalledWith({ code: '654321' }))
    expect(await screen.findByText('aaaaa-11111')).toBeTruthy()
    expect(screen.getByText('bbbbb-22222')).toBeTruthy()
  })

  it('disables with the password', async () => {
    mockSession = { user: { twoFactorEnabled: true } }
    const user = userEvent.setup()
    const { TwoFactorSettings } = await import(`./two-factor-settings?bypass=${Date.now()}`)
    render(<TwoFactorSettings />)

    expect(screen.getByText('On')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Turn off' }))
    await user.type(screen.getByLabelText('Password'), 'Password1')
    const buttons = screen.getAllByRole('button', { name: 'Turn off' })
    await user.click(buttons[buttons.length - 1]!)

    await waitFor(() => expect(mockDisable).toHaveBeenCalledWith({ password: 'Password1' }))
  })

  it('reads the manual-entry key from the otpauth URI', async () => {
    const { totpSecretFromUri } = await import(`./two-factor-settings?bypass=${Date.now()}`)
    expect(totpSecretFromUri(TOTP_URI)).toBe('JBSWY3DPEHPK3PXP')
    expect(totpSecretFromUri('not a uri')).toBe('')
  })
})
