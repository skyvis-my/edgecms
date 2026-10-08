import { describe, expect, it, mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { tenantScopedRoles } from '../data/data'

mock.module('@/components/select-dropdown', () => ({
  SelectDropdown: ({ items }: { items: Array<{ label: string; value: string }> }) => (
    <ul data-testid='role-options'>
      {items.map((item) => (
        <li key={item.value}>{item.label}</li>
      ))}
    </ul>
  ),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const { UsersActionDialog } = await import(`./users-action-dialog?bypass=${Date.now()}`)

const mockUser = {
  id: 'u1',
  firstName: 'Test',
  lastName: 'User',
  username: 'testuser',
  email: 'test@example.com',
  role: 'editor',
  status: 'active' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('UsersActionDialog role options', () => {
  it('hides superadmin for tenant-scoped role options', () => {
    render(
      <UsersActionDialog
        open
        onOpenChange={() => {}}
        roleOptions={tenantScopedRoles}
        currentRow={mockUser}
      />,
      { wrapper: createWrapper() }
    )

    expect(screen.queryByText('Superadmin')).not.toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('Editor')).toBeInTheDocument()
    expect(screen.getByText('Viewer')).toBeInTheDocument()
  })
})
