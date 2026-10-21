import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const edenGet = vi.fn()
const edenPost = vi.fn()
const signOut = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenGet,
  edenPost,
  edenPut: vi.fn(),
  edenDelete: vi.fn(),
  edenPostForTenant: vi.fn(),
  edenPostMultipart: vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({ signOut }))

const { PersonalDataSection } = await import('./personal-data-section?real')

describe('PersonalDataSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    URL.createObjectURL = vi.fn(() => 'blob:x') as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
  })

  it('downloads the export from /me/data-export', async () => {
    edenGet.mockResolvedValueOnce({ user: { id: 'u1' } })
    render(<PersonalDataSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }))
    await waitFor(() => expect(edenGet).toHaveBeenCalledWith('/me/data-export'))
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
  })

  it('only deletes after the user types DELETE', async () => {
    edenPost.mockResolvedValueOnce({ pseudonym: 'deleted-user:x' })
    signOut.mockResolvedValueOnce(undefined)
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)

    render(<PersonalDataSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    const confirm = await screen.findByRole('button', { name: 'Delete account' })
    expect(confirm).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    })
    expect(confirm).toHaveProperty('disabled', false)
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(edenPost).toHaveBeenCalledWith('/me/data-deletion', { confirm: 'DELETE' })
    )
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/sign-in'))
  })
})
