import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type OnChangeFn,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TanStackTable,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table'
import { useRef, useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { DataTablePagination } from './pagination'
import { DataTableToolbar, type DataTableToolbarProps } from './toolbar'

type DataTableProps<TData, TValue> = {
  data: TData[]
  columns: ColumnDef<TData, TValue>[]
  emptyMessage: string
  className?: string
  paginationClassName?: string
  enableRowSelection?: boolean
  toolbar?: Omit<DataTableToolbarProps<TData>, 'table'>
  renderAfterPagination?: (table: TanStackTable<TData>) => React.ReactNode
  getRowId?: (originalRow: TData, index: number, parent?: Row<TData>) => string
  manualPagination?: boolean
  manualFiltering?: boolean
  manualSorting?: boolean
  pageCount?: number
  rowCount?: number
  isLoading?: boolean
  state?: {
    rowSelection?: RowSelectionState
    columnVisibility?: VisibilityState
    sorting?: SortingState
    columnFilters?: ColumnFiltersState
    globalFilter?: string
    pagination?: PaginationState
  }
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>
  onSortingChange?: OnChangeFn<SortingState>
  onColumnFiltersChange?: OnChangeFn<ColumnFiltersState>
  onGlobalFilterChange?: OnChangeFn<string>
  onPaginationChange?: OnChangeFn<PaginationState>
  enableVirtualization?: boolean
  virtualizationThreshold?: number
  virtualizationEstimateSize?: number
  virtualizationMaxHeight?: number
}

export function DataTable<TData, TValue>({
  data,
  columns,
  emptyMessage,
  className,
  paginationClassName = 'mt-auto',
  enableRowSelection = false,
  toolbar,
  renderAfterPagination,
  getRowId,
  manualPagination = false,
  manualFiltering = false,
  manualSorting = false,
  pageCount,
  rowCount,
  isLoading = false,
  state,
  onRowSelectionChange,
  onColumnVisibilityChange,
  onSortingChange,
  onColumnFiltersChange,
  onGlobalFilterChange,
  onPaginationChange,
  enableVirtualization = false,
  virtualizationThreshold = 50,
  virtualizationEstimateSize = 52,
  virtualizationMaxHeight = 680,
}: DataTableProps<TData, TValue>) {
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({})
  const [internalColumnVisibility, setInternalColumnVisibility] = useState<VisibilityState>({})
  const [internalSorting, setInternalSorting] = useState<SortingState>([])
  const [internalColumnFilters, setInternalColumnFilters] = useState<ColumnFiltersState>([])
  const [internalGlobalFilter, setInternalGlobalFilter] = useState('')
  const [internalPagination, setInternalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const rowSelection = state?.rowSelection ?? internalRowSelection
  const columnVisibility = state?.columnVisibility ?? internalColumnVisibility
  const sorting = state?.sorting ?? internalSorting
  const columnFilters = state?.columnFilters ?? internalColumnFilters
  const globalFilter = state?.globalFilter ?? internalGlobalFilter
  const pagination = state?.pagination ?? internalPagination

  const table = useReactTable<TData>({
    data,
    columns,
    state: {
      sorting,
      pagination,
      rowSelection,
      columnFilters,
      globalFilter,
      columnVisibility,
    },
    enableRowSelection,
    getRowId,
    onPaginationChange: onPaginationChange ?? setInternalPagination,
    onColumnFiltersChange: onColumnFiltersChange ?? setInternalColumnFilters,
    onGlobalFilterChange: onGlobalFilterChange ?? setInternalGlobalFilter,
    onRowSelectionChange: onRowSelectionChange ?? setInternalRowSelection,
    onSortingChange: onSortingChange ?? setInternalSorting,
    onColumnVisibilityChange: onColumnVisibilityChange ?? setInternalColumnVisibility,
    manualPagination,
    manualFiltering,
    manualSorting,
    pageCount,
    rowCount,
    getCoreRowModel: getCoreRowModel(),
    ...(manualPagination ? {} : { getPaginationRowModel: getPaginationRowModel() }),
    ...(manualFiltering
      ? {}
      : {
          getFilteredRowModel: getFilteredRowModel(),
          getFacetedRowModel: getFacetedRowModel(),
          getFacetedUniqueValues: getFacetedUniqueValues(),
        }),
    ...(manualSorting ? {} : { getSortedRowModel: getSortedRowModel() }),
  })
  const tableContainerRef = useRef<HTMLDivElement | null>(null)
  const rows = table.getRowModel().rows
  const virtualized = !isLoading && enableVirtualization && rows.length > virtualizationThreshold
  const [scrollTop, setScrollTop] = useState(0)
  const overscan = 8
  const startIndex = virtualized
    ? Math.max(0, Math.floor(scrollTop / virtualizationEstimateSize) - overscan)
    : 0
  const endIndex = virtualized
    ? Math.min(
        rows.length,
        Math.ceil((scrollTop + virtualizationMaxHeight) / virtualizationEstimateSize) + overscan
      )
    : rows.length
  const topPadding = virtualized ? startIndex * virtualizationEstimateSize : 0
  const bottomPadding = virtualized ? (rows.length - endIndex) * virtualizationEstimateSize : 0
  const visibleRows = virtualized ? rows.slice(startIndex, endIndex) : rows

  return (
    <div
      className={cn(
        'max-sm:has-[div[role="toolbar"]]:mb-16',
        'flex flex-1 flex-col gap-4',
        className
      )}
    >
      {toolbar ? <DataTableToolbar table={table} {...toolbar} /> : null}
      <div
        ref={tableContainerRef}
        className='overflow-auto rounded-md border'
        style={virtualized ? { maxHeight: `${virtualizationMaxHeight}px` } : undefined}
        onScroll={virtualized ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
      >
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className='group/row'>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    aria-sort={
                      header.column.getCanSort()
                        ? header.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : 'none'
                        : undefined
                    }
                    className={cn(
                      'bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted',
                      header.column.columnDef.meta?.className,
                      header.column.columnDef.meta?.thClassName
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {Array.from({ length: columns.length }).map((_, colIndex) => (
                    <TableCell key={`skeleton-${rowIndex}-${colIndex}`}>
                      <Skeleton className='h-4 w-full' />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows?.length ? (
              <>
                {virtualized && topPadding > 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} style={{ height: `${topPadding}px` }} />
                  </TableRow>
                ) : null}
                {visibleRows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className='group/row'
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted',
                        cell.column.columnDef.meta?.className,
                        cell.column.columnDef.meta?.tdClassName
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
                ))}
                {virtualized && bottomPadding > 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} style={{ height: `${bottomPadding}px` }} />
                  </TableRow>
                ) : null}
              </>
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className='h-24 text-center'>
                  <div className='space-y-2'>
                    <p>{emptyMessage}</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} className={paginationClassName} />
      {renderAfterPagination?.(table)}
    </div>
  )
}
