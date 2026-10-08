import type {
  ColumnFiltersState,
  PaginationState,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import { useState } from 'react'
import { DataTable } from '@/components/data-table'
import type { CollectionDefinition } from '../api/collections-api'
import { collectionsColumns as columns } from './collections-columns'

type CollectionsTableProps = {
  data: CollectionDefinition[]
}

export const COLLECTIONS_EMPTY_MESSAGE =
  'No collections yet. Create a collection to start modeling content.'

export function CollectionsTable({ data }: CollectionsTableProps) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })

  return (
    <DataTable
      data={data}
      columns={columns}
      emptyMessage={COLLECTIONS_EMPTY_MESSAGE}
      enableRowSelection
      state={{ sorting, pagination, rowSelection, columnFilters, columnVisibility }}
      onPaginationChange={setPagination}
      onColumnFiltersChange={setColumnFilters}
      onRowSelectionChange={setRowSelection}
      onSortingChange={setSorting}
      onColumnVisibilityChange={setColumnVisibility}
      toolbar={{
        searchPlaceholder: 'Filter collections...',
        searchKey: 'name',
        filters: [
          {
            columnId: 'singleton',
            title: 'Type',
            options: [
              { label: 'Collection', value: 'false' },
              { label: 'Singleton', value: 'true' },
            ],
          },
        ],
      }}
    />
  )
}
