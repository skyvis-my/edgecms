import type { ColumnDef } from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import { useWebhookDeliveries, type WebhookDelivery } from './api'

type DeliveryLogProps = {
  webhookId: string
}

function ExpandableRow({ delivery }: { delivery: WebhookDelivery }) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <>
      <TableRow className='cursor-pointer' onClick={() => setIsExpanded(!isExpanded)}>
        <TableCell className='w-8'>
          {isExpanded ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
        </TableCell>
        <TableCell className='text-nowrap'>
          <span title={toBrowserDateTime(delivery.createdAt) ?? undefined}>
            {toRelativeTime(delivery.createdAt)}
          </span>
        </TableCell>
        <TableCell>
          <Badge variant='secondary'>{delivery.eventType}</Badge>
        </TableCell>
        <TableCell>
          <Badge
            variant='outline'
            className={cn(
              delivery.status === 'delivered'
                ? 'border-green-500 text-green-600'
                : delivery.status === 'failed'
                  ? 'border-red-500 text-red-600'
                  : 'border-yellow-500 text-yellow-600'
            )}
          >
            {delivery.status}
          </Badge>
        </TableCell>
        <TableCell className='text-center'>{delivery.responseStatusCode || '-'}</TableCell>
        <TableCell className='text-center'>{delivery.retryCount}</TableCell>
      </TableRow>
      {isExpanded && delivery.responseBody && (
        <TableRow>
          <TableCell colSpan={6} className='bg-muted/50'>
            <div className='space-y-2 p-2'>
              <div className='font-medium text-sm'>Response Body:</div>
              <pre className='text-xs bg-background p-3 rounded overflow-auto max-h-48 border'>
                {delivery.responseBody}
              </pre>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

const columns: ColumnDef<WebhookDelivery>[] = [
  {
    id: 'expand',
    header: '',
    cell: () => null,
  },
  {
    accessorKey: 'createdAt',
    header: 'Timestamp',
  },
  {
    accessorKey: 'eventType',
    header: 'Event Type',
  },
  {
    accessorKey: 'status',
    header: 'Status',
  },
  {
    accessorKey: 'responseStatusCode',
    header: 'Response Code',
  },
  {
    accessorKey: 'retryCount',
    header: 'Retries',
  },
]

export function DeliveryLog({ webhookId }: DeliveryLogProps) {
  const { data: deliveries, isLoading, error } = useWebhookDeliveries(webhookId)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })

  const table = useReactTable({
    data: deliveries || [],
    columns,
    state: {
      pagination,
    },
    onPaginationChange: setPagination,
    getPaginationRowModel: getPaginationRowModel(),
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery Log</CardTitle>
        <CardDescription>Recent webhook delivery attempts and their results</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className='space-y-2'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        )}

        {error && (
          <div className='rounded-md border border-red-200 bg-red-50 p-4 text-red-600'>
            Failed to load delivery logs. Please try again.
          </div>
        )}

        {deliveries && deliveries.length === 0 && (
          <div className='text-center text-muted-foreground py-8'>
            No deliveries yet. This webhook has not been triggered.
          </div>
        )}

        {deliveries && deliveries.length > 0 && (
          <div className='space-y-4'>
            <div className='overflow-hidden rounded-md border'>
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.map((row) => (
                    <ExpandableRow key={row.id} delivery={row.original} />
                  ))}
                </TableBody>
              </Table>
            </div>

            {table.getPageCount() > 1 && (
              <div className='flex items-center justify-between'>
                <div className='text-sm text-muted-foreground'>
                  Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                </div>
                <div className='flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  >
                    Previous
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
