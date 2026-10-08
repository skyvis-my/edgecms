import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTableColumnHeader,
  DataTablePagination,
  DataTableToolbar,
} from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getCurrentTenantSlug } from '@/features/tenants/api'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import { useDeleteWebhook, type WebhookDefinition } from './api'

type WebhooksTableProps = {
  data: WebhookDefinition[]
}

function WebhookRowActions({ webhook }: { webhook: WebhookDefinition }) {
  const deleteMutation = useDeleteWebhook()
  const tenantSlug = getCurrentTenantSlug()
  const editWebhookPath = tenantSlug ? `/tenants/${tenantSlug}/webhooks/${webhook.id}` : '/webhooks'
  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(webhook.id)
      toast.success('Webhook deleted successfully')
      setDeleteOpen(false)
    } catch {
      toast.error('Failed to delete webhook')
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' className='h-8 w-8 p-0'>
            <span className='sr-only'>Open menu</span>
            <MoreHorizontal className='h-4 w-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link to={editWebhookPath}>
              <Pencil className='mr-2 h-4 w-4' />
              Edit
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDeleteOpen(true)} className='text-red-600'>
            <Trash2 className='mr-2 h-4 w-4' />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title='Delete webhook'
        desc='Are you sure you want to delete this webhook? This action cannot be undone.'
        confirmText='Delete'
        destructive
        isLoading={deleteMutation.isPending}
        handleConfirm={() => void handleDelete()}
      />
    </>
  )
}

const columns: ColumnDef<WebhookDefinition>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label='Select all'
        className='translate-y-[2px]'
      />
    ),
    meta: {
      className: cn('max-md:sticky start-0 z-10 rounded-tl-[inherit]'),
    },
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label='Select row'
        className='translate-y-[2px]'
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'url',
    header: ({ column }) => <DataTableColumnHeader column={column} title='URL' />,
    cell: ({ row }) => (
      <div className='max-w-xs truncate ps-3 font-medium'>{row.getValue('url')}</div>
    ),
    meta: {
      className: cn(
        'drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.1)] dark:drop-shadow-[0_1px_2px_rgb(255_255_255_/_0.1)]',
        'ps-0.5 max-md:sticky start-6 @4xl/content:table-cell @4xl/content:drop-shadow-none'
      ),
    },
    enableHiding: false,
  },
  {
    accessorKey: 'events',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Events' />,
    cell: ({ row }) => {
      const events = row.getValue('events') as string[]
      return (
        <div className='flex flex-wrap gap-1'>
          {events.slice(0, 3).map((event) => (
            <Badge key={event} variant='secondary' className='text-xs'>
              {event}
            </Badge>
          ))}
          {events.length > 3 && (
            <Badge variant='secondary' className='text-xs'>
              +{events.length - 3}
            </Badge>
          )}
        </div>
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Status' />,
    cell: ({ row }) => {
      const status = row.getValue('status') as string
      return (
        <Badge
          variant='outline'
          className={cn(
            status === 'enabled'
              ? 'border-green-500 text-green-600'
              : 'border-gray-500 text-gray-600'
          )}
        >
          {status}
        </Badge>
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: 'lastDeliveryStatus',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Last Delivery' />,
    cell: ({ row }) => {
      const status = row.getValue('lastDeliveryStatus') as string | undefined
      const lastDeliveryAt = row.original.lastDeliveryAt

      if (!status || !lastDeliveryAt) {
        return <div className='text-muted-foreground text-sm'>No deliveries</div>
      }

      return (
        <div className='flex flex-col gap-1'>
          <Badge
            variant='outline'
            className={cn(
              status === 'delivered'
                ? 'border-green-500 text-green-600'
                : status === 'failed'
                  ? 'border-red-500 text-red-600'
                  : 'border-yellow-500 text-yellow-600'
            )}
          >
            {status}
          </Badge>
          <span
            className='text-xs text-muted-foreground'
            title={toBrowserDateTime(lastDeliveryAt) ?? undefined}
          >
            {toRelativeTime(lastDeliveryAt)}
          </span>
        </div>
      )
    },
    enableSorting: false,
  },
  {
    id: 'actions',
    cell: ({ row }) => <WebhookRowActions webhook={row.original} />,
  },
]

export function WebhooksTable({ data }: WebhooksTableProps) {
  const [rowSelection, setRowSelection] = useState({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      pagination,
      rowSelection,
      columnFilters,
      columnVisibility,
    },
    enableRowSelection: true,
    onPaginationChange: setPagination,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getPaginationRowModel: getPaginationRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  return (
    <div className={cn('max-sm:has-[div[role="toolbar"]]:mb-16', 'flex flex-1 flex-col gap-4')}>
      <DataTableToolbar
        table={table}
        searchPlaceholder='Filter webhooks...'
        searchKey='url'
        filters={[
          {
            columnId: 'status',
            title: 'Status',
            options: [
              { label: 'Enabled', value: 'enabled' },
              { label: 'Disabled', value: 'disabled' },
            ],
          },
        ]}
      />
      <div className='overflow-hidden rounded-md border'>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className='group/row'>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
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
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
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
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className='h-24 text-center'>
                  No webhooks found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} className='mt-auto' />
    </div>
  )
}
