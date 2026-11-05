/**
 * PL-03: in a tenant, the edit dialog offers built-in and custom roles and
 * saves through the tenant-scoped role route.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { ApiClientError } from '@/lib/api-error'

const mockEdenGet = vi.fn()
const mockEdenPut = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()

vi.mock('@/lib/eden-client', () => ({
  edenGet: (...args: unknown[]) => mockEdenGet(...args),
  edenPut: (...args: unknown[]) => mockEdenPut(...args),
  edenPost: vi.fn(),
  edenDelete: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}))
vi.mock('@/components/select-dropdown', () => ({
  SelectDropdown: ({
    items,
    onValueChange,
    defaultValue,
  }: {
    items: Array<{ label: string; value: string }>
    onValueChange: (value: string) => void
    defaultValue?: string
  }) => (
    <ul data-testid='role-options' data-selected={defaultValue}>
      {items.map((item) => (
        <li key={item.value}>
          <button type='button' onClick={() => onValueChange(item.value)}>
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  ),
}))

const ROLES = [
  { id: 'r1', name: 'admin', description: null, permissionCount: 8 },
  { id: 'r2', name: 'blog-writer', description: 'Writes the blog', permissionCount: 2 },
  { id: 'r3', name: 'editor', description: null, permissionCount: 10 },
  { id: 'r4', name: 'owner', description: null, permissionCount: 1 },
  { id: 'r5', name: 'viewer', description: null, permissionCount: 3 },
]

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
  firstName: 'Mia',
  lastName: 'Member',
  username: 'mia',
  email: 'mia@example.com',
  phoneNumber: '',
  status: 'active' as const,
  role: 'editor' as const,
  tenantRole: 'member',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

async function renderDialog() {
  const { UsersActionDialog } = await import(`./users-action-dialog?bypass=${Date.now()}`)
  const onOpenChange = vi.fn()
  render(
    <UsersActionDialog open onOpenChange={onOpenChange} currentRow={currentRow} tenantSlug='acme' />,
    { wrapper: createWrapper() }
  )
  return { onOpenChange }
}

describe('UsersActionDialog custom roles (tenant)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEdenGet.mockImplementation(async (path: string) => {
      if (path === '/admin/roles') return ROLES
      throw new Error(`unexpected GET ${path}`)
    })
    mockEdenPut.mockResolvedValue({ userId: 'u1', role: 'blog-writer', changed: true })
  })

  it('lists built-in tenant roles and the tenant custom roles, starting from the stored role', async () => {
    await renderDialog()
    expect(await screen.findByRole('button', { name: 'blog-writer (custom)' })).toBeInTheDocument()
    for (const label of ['Owner', 'Admin', 'Editor', 'Member', 'Viewer']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /superadmin/i })).not.toBeInTheDocument()
    // Built-in role rows are not listed twice.
    expect(screen.getAllByRole('button', { name: /^Editor$/ })).toHaveLength(1)
    expect(screen.getByTestId('role-options').dataset.selected).toBe('member')
  })

  it('saves a custom role through the tenant role route', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = await renderDialog()
    await user.click(await screen.findByRole('button', { name: 'blog-writer (custom)' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(mockEdenPut).toHaveBeenCalledWith('/admin/users/u1/role', { role: 'blog-writer' })
    )
    expect(mockToastSuccess).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows the server reason when the change is refused', async () => {
    mockEdenPut.mockRejectedValue(
      new ApiClientError({
        status: 409,
        code: 'LAST_OWNER',
        message: 'A tenant must keep at least one owner',
      })
    )
    const user = userEvent.setup()
    await renderDialog()
    await user.click(await screen.findByRole('button', { name: 'Viewer' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('A tenant must keep at least one owner')
    )
  })
})
