import type {
  PaginationState,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import { useState } from 'react'
import { DataTable } from '@/components/data-table'
import type { CollectionDefinition } from '@/features/collections/api/collections-api'
import { type NavigateFn, useTableUrlState } from '@/hooks/use-table-url-state'
import type { Entry } from '../api/entries-api'
import { getEntriesColumns } from './entries-columns'

type EntriesTableProps = {
  data: Entry[]
  collection: CollectionDefinition
  totalRows: number
  search: Record<string, unknown>
  navigate: NavigateFn
}

export function EntriesTable({ data, collection, totalRows, search, navigate }: EntriesTableProps) {
  const columns = getEntriesColumns(collection)

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [sorting, setSorting] = useState<SortingState>([])

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters: urlColumnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
  } = useTableUrlState({
    search,
    navigate,
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })

  const pageCount = Math.max(1, Math.ceil(totalRows / Math.max(1, pagination.pageSize)))

  return (
    <DataTable
      data={data}
      columns={columns}
      emptyMessage='No entries found.'
      enableRowSelection
      state={{
        sorting,
        pagination: pagination as PaginationState,
        globalFilter,
        rowSelection,
        columnFilters: urlColumnFilters,
        columnVisibility,
      }}
      onPaginationChange={onPaginationChange}
      onGlobalFilterChange={onGlobalFilterChange}
      onColumnFiltersChange={onColumnFiltersChange}
      onRowSelectionChange={setRowSelection}
      onSortingChange={setSorting}
      onColumnVisibilityChange={setColumnVisibility}
      manualPagination
      rowCount={totalRows}
      pageCount={pageCount}
      enableVirtualization
      virtualizationThreshold={50}
      virtualizationEstimateSize={56}
      toolbar={{
        searchPlaceholder: 'Filter by slug or field values...',
        filters: [
          {
            columnId: 'status',
            title: 'Status',
            options: [
              { label: 'Draft', value: 'draft' },
              { label: 'Published', value: 'published' },
              { label: 'Scheduled', value: 'scheduled' },
              { label: 'Archived', value: 'archived' },
            ],
          },
        ],
      }}
    />
  )
}
