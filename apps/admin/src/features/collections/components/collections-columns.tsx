import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table'
import { LongText } from '@/components/long-text'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import type { CollectionDefinition } from '../api/collections-api'
import { CollectionsRowActions } from './collections-row-actions'

export const collectionsColumns: ColumnDef<CollectionDefinition>[] = [
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
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
    cell: ({ row }) => (
      <LongText className='max-w-36 ps-3 font-medium'>{row.getValue('name')}</LongText>
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
    accessorKey: 'slug',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Slug' />,
    cell: ({ row }) => (
      <div className='w-fit ps-2 text-nowrap text-muted-foreground'>{row.getValue('slug')}</div>
    ),
  },
  {
    accessorKey: 'singleton',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Type' />,
    cell: ({ row }) => {
      const singleton = row.getValue('singleton') as boolean
      return (
        <Badge
          variant='outline'
          className={cn(
            singleton ? 'border-blue-500 text-blue-600' : 'border-green-500 text-green-600'
          )}
        >
          {singleton ? 'Singleton' : 'Collection'}
        </Badge>
      )
    },
    enableSorting: false,
  },
  {
    id: 'fieldsCount',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Fields' />,
    cell: ({ row }) => {
      const fields = row.original.fields
      return <div className='text-center'>{fields.length}</div>
    },
    enableSorting: false,
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Created' />,
    cell: ({ row }) => {
      const createdAt = row.getValue('createdAt') as string
      return (
        <div className='text-nowrap' title={toBrowserDateTime(createdAt) ?? undefined}>
          {toRelativeTime(createdAt)}
        </div>
      )
    },
  },
  {
    id: 'actions',
    cell: CollectionsRowActions,
  },
]
