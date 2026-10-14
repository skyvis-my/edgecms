import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Table } from '@tanstack/react-table'
import { toast } from 'sonner'

vi.mock('sonner', () => ({
  toast: {
    promise: vi.fn(),
  },
}))

vi.mock('./users-multi-delete-dialog', () => ({
  UsersMultiDeleteDialog: ({ open }: { open: boolean }) => (
    open ? <div data-testid='multi-delete-dialog'>Delete Dialog Open</div> : null
  ),
}))

import { DataTableBulkActions } from './data-table-bulk-actions'

function createMockTable(users: Array<{ id: string; email: string }> = []) {
  const resetRowSelection = vi.fn()
  const rows = users.map((u, i) => ({
    id: `row-${i}`,
    original: u,
  }))

  const table = {
    getFilteredSelectedRowModel: () => ({
      rows,
    }),
    resetRowSelection,
  } as unknown as Table<unknown>

  return { table, resetRowSelection }
}

describe('DataTableBulkActions (Users)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all action buttons when rows are selected', () => {
    const { table } = createMockTable([{ id: 'u1', email: 'one@example.com' }])
    render(<DataTableBulkActions table={table} />)

    expect(screen.getByLabelText('Invite selected users')).toBeDefined()
    expect(screen.getByLabelText('Activate selected users')).toBeDefined()
    expect(screen.getByLabelText('Deactivate selected users')).toBeDefined()
    expect(screen.getByLabelText('Delete selected users')).toBeDefined()
  })

  it('triggers bulk invite toast and resets row selection', () => {
    const { table, resetRowSelection } = createMockTable([
      { id: 'u1', email: 'one@example.com' },
      { id: 'u2', email: 'two@example.com' },
    ])
    render(<DataTableBulkActions table={table} />)

    fireEvent.click(screen.getByLabelText('Invite selected users'))

    expect(toast.promise).toHaveBeenCalledTimes(1)
    expect(resetRowSelection).toHaveBeenCalledTimes(1)

    // Verify success callback logic
    const options = (toast.promise as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      success: () => string
    }
    expect(options.success()).toBe('Invited 2 users')
  })

  it('triggers bulk status activation and deactivation', () => {
    const { table, resetRowSelection } = createMockTable([
      { id: 'u1', email: 'one@example.com' },
    ])
    render(<DataTableBulkActions table={table} />)

    // Activate
    fireEvent.click(screen.getByLabelText('Activate selected users'))
    expect(toast.promise).toHaveBeenCalledTimes(1)
    expect(resetRowSelection).toHaveBeenCalledTimes(1)

    const activateOpts = (toast.promise as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      success: () => string
    }
    expect(activateOpts.success()).toBe('Activated 1 user')

    // Deactivate
    fireEvent.click(screen.getByLabelText('Deactivate selected users'))
    expect(toast.promise).toHaveBeenCalledTimes(2)

    const deactivateOpts = (toast.promise as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![1] as {
      success: () => string
    }
    expect(deactivateOpts.success()).toBe('Deactivated 1 user')
  })

  it('opens delete confirmation dialog when delete button clicked', () => {
    const { table } = createMockTable([{ id: 'u1', email: 'one@example.com' }])
    render(<DataTableBulkActions table={table} />)

    expect(screen.queryByTestId('multi-delete-dialog')).toBeNull()
    fireEvent.click(screen.getByLabelText('Delete selected users'))
    expect(screen.getByTestId('multi-delete-dialog')).toBeDefined()
  })
})
