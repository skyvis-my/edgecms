import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { UsersActionDialog } from './users-action-dialog'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const currentRow = {
  id: 'u1',
  firstName: 'John',
  lastName: 'Doe',
  username: 'jdoe',
  email: 'john@example.com',
  phoneNumber: '+12025550123',
  status: 'active',
  role: 'admin',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} as const

describe('UsersActionDialog', () => {
  it('does not show phone number input in edit mode', () => {
    render(<UsersActionDialog open onOpenChange={() => {}} currentRow={currentRow} />, {
      wrapper: createWrapper(),
    })

    expect(screen.queryByLabelText('Phone Number')).not.toBeInTheDocument()
  })
})
