import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'

const mockMutateAsync = vi.fn()
let mockIsPending = false

vi.mock('@/features/tenants/api', () => ({
  useAddTenantUser: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockIsPending,
  }),
}))

vi.mock('@/components/select-dropdown', () => ({
  SelectDropdown: ({
    value,
    defaultValue,
    onValueChange,
  }: {
    value?: string
    defaultValue?: string
    onValueChange?: (val: string) => void
  }) => (
    <select
      data-testid='select-role'
      value={value ?? defaultValue ?? ''}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      <option value=''>Select a role</option>
      <option value='admin'>Admin</option>
      <option value='editor'>Editor</option>
    </select>
  ),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { UsersInviteDialog } from './users-invite-dialog'

describe('UsersInviteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsPending = false
  })

  it('renders dialog elements when open is true', () => {
    render(
      <UsersInviteDialog
        open={true}
        onOpenChange={() => {}}
        tenantSlug='demo-tenant'
      />
    )

    expect(screen.getByText('Invite User')).toBeDefined()
    expect(screen.getByPlaceholderText('eg: john.doe@gmail.com')).toBeDefined()
    expect(screen.getByText('Cancel')).toBeDefined()
    expect(screen.getByRole('button', { name: /Invite/i })).toBeDefined()
  })

  it('displays error if submitted without tenant slug', async () => {
    render(
      <UsersInviteDialog
        open={true}
        onOpenChange={() => {}}
      />
    )

    const emailInput = screen.getByPlaceholderText('eg: john.doe@gmail.com')
    fireEvent.change(emailInput, { target: { value: 'user@example.com' } })

    const roleSelect = screen.getByTestId('select-role')
    fireEvent.change(roleSelect, { target: { value: 'admin' } })

    const form = document.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Invites are only available in tenant context')
    })
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })

  it('submits form successfully and closes dialog', async () => {
    mockMutateAsync.mockResolvedValue({})
    const onOpenChange = vi.fn()

    render(
      <UsersInviteDialog
        open={true}
        onOpenChange={onOpenChange}
        tenantSlug='acme'
        roleOptions={[{ label: 'Admin', value: 'admin' }]}
      />
    )

    const emailInput = screen.getByPlaceholderText('eg: john.doe@gmail.com')
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } })

    const roleSelect = screen.getByTestId('select-role')
    fireEvent.change(roleSelect, { target: { value: 'admin' } })

    const descInput = screen.getByPlaceholderText(/Add a personal note/i)
    fireEvent.change(descInput, { target: { value: 'Welcome to team' } })

    const form = document.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        slug: 'acme',
        input: { userId: 'test@example.com', role: 'admin' },
      })
      expect(toast.success).toHaveBeenCalledWith('Invited test@example.com')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('handles submission error gracefully and displays error toast', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Network error'))
    const onOpenChange = vi.fn()

    render(
      <UsersInviteDialog
        open={true}
        onOpenChange={onOpenChange}
        tenantSlug='acme'
      />
    )

    const emailInput = screen.getByPlaceholderText('eg: john.doe@gmail.com')
    fireEvent.change(emailInput, { target: { value: 'err@example.com' } })

    const roleSelect = screen.getByTestId('select-role')
    fireEvent.change(roleSelect, { target: { value: 'editor' } })

    const form = document.querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to invite user')
    })
  })

  it('calls onOpenChange when cancel button is clicked', () => {
    const onOpenChange = vi.fn()
    render(
      <UsersInviteDialog
        open={true}
        onOpenChange={onOpenChange}
        tenantSlug='acme'
      />
    )

    const cancelBtn = screen.getByText('Cancel')
    fireEvent.click(cancelBtn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
