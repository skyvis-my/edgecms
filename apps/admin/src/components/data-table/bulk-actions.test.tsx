import { describe, expect, it, vi } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Table } from '@tanstack/react-table'
import { DataTableBulkActions } from './bulk-actions'

function createMockTable(selectedCount = 0) {
  const resetRowSelection = vi.fn()
  const rows = Array.from({ length: selectedCount }, (_, i) => ({ id: `row-${i}` }))
  const table = {
    getFilteredSelectedRowModel: () => ({
      rows,
    }),
    resetRowSelection,
  } as unknown as Table<unknown>
  return { table, resetRowSelection }
}

describe('DataTableBulkActions', () => {
  it('returns null when no rows are selected', () => {
    const { table } = createMockTable(0)
    const { container } = render(
      <DataTableBulkActions table={table} entityName='user'>
        <button type='button'>Delete</button>
      </DataTableBulkActions>
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders toolbar with singular entity name and children when 1 row is selected', () => {
    const { table, resetRowSelection } = createMockTable(1)
    render(
      <DataTableBulkActions table={table} entityName='entry'>
        <button type='button'>Publish</button>
      </DataTableBulkActions>
    )

    expect(screen.getByRole('toolbar')).toBeDefined()
    expect(screen.getByText('1')).toBeDefined()
    expect(screen.getByText('entry')).toBeDefined()
    expect(screen.getByText('Publish')).toBeDefined()

    const clearBtn = screen.getByLabelText('Clear selection')
    fireEvent.click(clearBtn)
    expect(resetRowSelection).toHaveBeenCalledTimes(1)
  })

  it('renders plural entity name and handles keyboard navigation', () => {
    const { table, resetRowSelection } = createMockTable(3)
    render(
      <DataTableBulkActions table={table} entityName='user'>
        <button type='button'>Action 1</button>
        <button type='button'>Action 2</button>
      </DataTableBulkActions>
    )

    expect(screen.getByText('3')).toBeDefined()
    expect(screen.getByText('users')).toBeDefined()

    const toolbar = screen.getByRole('toolbar')
    const buttons = toolbar.querySelectorAll('button')
    expect(buttons.length).toBe(3) // Clear selection + 2 children

    // Focus first button
    buttons[0]!.focus()
    expect(document.activeElement).toBe(buttons[0]!)

    // ArrowRight navigates to next
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(buttons[1]!)

    // ArrowLeft navigates to previous
    fireEvent.keyDown(toolbar, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(buttons[0]!)

    // End navigates to last
    fireEvent.keyDown(toolbar, { key: 'End' })
    expect(document.activeElement).toBe(buttons[2]!)

    // Home navigates to first
    fireEvent.keyDown(toolbar, { key: 'Home' })
    expect(document.activeElement).toBe(buttons[0]!)

    // Escape clears selection
    fireEvent.keyDown(toolbar, { key: 'Escape' })
    expect(resetRowSelection).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape key if triggered from dropdown trigger or content', () => {
    const { table, resetRowSelection } = createMockTable(2)
    render(
      <DataTableBulkActions table={table} entityName='item'>
        <button type='button' data-slot='dropdown-menu-trigger'>
          Options
        </button>
      </DataTableBulkActions>
    )

    const dropdownTrigger = screen.getByText('Options')
    dropdownTrigger.focus()

    fireEvent.keyDown(dropdownTrigger, { key: 'Escape' })
    expect(resetRowSelection).not.toHaveBeenCalled()
  })
})
