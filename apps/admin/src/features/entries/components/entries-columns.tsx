import type { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table'
import { LongText } from '@/components/long-text'
import { Checkbox } from '@/components/ui/checkbox'
import type { CollectionDefinition } from '@/features/collections/api/collections-api'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import type { Entry } from '../api/entries-api'
import type { EntryQueueState } from '../lib/entry-status'
import { EntryStatusIndicator } from './entry-status-indicator'
import { EntriesRowActions } from './entries-row-actions'



function toDisplayString(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(toDisplayString).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(toDisplayString)
      .filter(Boolean)
      .join(' ')
  }
  return String(value)
}

/**
 * Dynamically generate columns based on collection fields
 */
export function getEntriesColumns(
  collection: CollectionDefinition,
  options: { queueByEntry?: Map<string, EntryQueueState> } = {}
): ColumnDef<Entry>[] {
  const queueByEntry = options.queueByEntry
  // OF-05: below md the Entry column carries slug, status and updated time, so the
  // duplicate columns are hidden and rows fit a 375px screen without sideways scrolling.
  const hideBelowMd = 'max-md:hidden'
  const collectionFields = collection.fields ?? []
  const baseColumns: ColumnDef<Entry>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
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
  ]

  // Add dynamic field columns (limit to first 3 fields)
  const fieldsToShow = collectionFields.slice(0, 3)

  const fieldColumns: ColumnDef<Entry>[] = fieldsToShow.map((field, index) => ({
    id: field.name,
    accessorFn: (row) => toDisplayString(row.data[field.name]),
    header: ({ column }) => <DataTableColumnHeader column={column} title={field.name} />,
    cell: ({ row }) => {
      const value = row.original.data[field.name]
      let displayValue = ''
      let isoTitle: string | undefined

      if (value == null) {
        displayValue = '-'
      } else {
        switch (field.type) {
          case 'boolean':
            displayValue = value ? 'Yes' : 'No'
            break
          case 'date':
            displayValue = toRelativeTime(value as string)
            isoTitle = toBrowserDateTime(value as string) ?? undefined
            break
          case 'json':
            displayValue = `${JSON.stringify(value).slice(0, 50)}...`
            break
          default:
            displayValue = toDisplayString(value).slice(0, 100)
        }
      }

      return (
        <span title={isoTitle}>
          <LongText className={cn('max-w-36', index === 0 ? 'ps-3 font-medium' : '')}>
            {displayValue}
          </LongText>
        </span>
      )
    },
    meta:
      index === 0
        ? {
            className: cn(
              'drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.1)] dark:drop-shadow-[0_1px_2px_rgb(255_255_255_/_0.1)]',
              'ps-0.5 start-6 @4xl/content:table-cell @4xl/content:drop-shadow-none',
              hideBelowMd
            ),
          }
        : { className: hideBelowMd },
    enableHiding: index !== 0,
  }))

  const metaColumns: ColumnDef<Entry>[] = [
    {
      id: 'details',
      accessorFn: (row) => {
        const detailsPreview = fieldsToShow
          .map((field) => toDisplayString(row.data[field.name]))
          .filter(Boolean)
          .join(' ')
        return `${row.slug} ${row.status} ${detailsPreview}`
      },
      header: ({ column }) => <DataTableColumnHeader column={column} title='Entry' />,
      cell: ({ row }) => {
        const entry = row.original
        const detailsPreview = fieldsToShow
          .map((field) => {
            const value = toDisplayString(entry.data[field.name]).trim()
            return value ? `${field.name}: ${value}` : ''
          })
          .filter(Boolean)
          .join(' • ')

        return (
          <div className='min-w-0 space-y-1 py-1 md:min-w-72'>
            <div className='font-medium break-all'>{entry.slug}</div>
            <EntryStatusIndicator
              className='md:hidden'
              status={entry.status}
              publishAt={entry.publishAt}
              unpublishAt={entry.unpublishAt}
              queue={queueByEntry?.get(entry.id)}
            />
            <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
              <span>Version {entry.version}</span>
              <span title={toBrowserDateTime(entry.updatedAt) ?? undefined}>
                Updated {toRelativeTime(entry.updatedAt)}
              </span>
            </div>
            {detailsPreview ? (
              <p className='line-clamp-2 text-xs text-muted-foreground'>{detailsPreview}</p>
            ) : null}
          </div>
        )
      },
      enableSorting: false,
    },
    {
      accessorKey: 'slug',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Slug' />,
      cell: ({ row }) => (
        <div className='w-fit ps-2 text-nowrap text-muted-foreground'>{row.getValue('slug')}</div>
      ),
      meta: { className: hideBelowMd },
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Status' />,
      cell: ({ row }) => {
        const entry = row.original
        return (
          <EntryStatusIndicator
            status={entry.status}
            publishAt={entry.publishAt}
            unpublishAt={entry.unpublishAt}
            queue={queueByEntry?.get(entry.id)}
          />
        )
      },
      meta: { className: hideBelowMd },
      enableSorting: false,
    },
    {
      accessorKey: 'updatedAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Updated' />,
      cell: ({ row }) => {
        const updatedAt = row.getValue('updatedAt') as string
        return (
          <div className='text-nowrap' title={toBrowserDateTime(updatedAt) ?? undefined}>
            {toRelativeTime(updatedAt)}
          </div>
        )
      },
      meta: { className: hideBelowMd },
    },
    {
      id: 'actions',
      cell: EntriesRowActions,
      enableHiding: false,
    },
  ]

  return [...baseColumns, ...fieldColumns, ...metaColumns]
}
