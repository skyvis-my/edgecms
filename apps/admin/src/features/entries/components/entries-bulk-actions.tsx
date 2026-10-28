import type { Table } from '@tanstack/react-table'
import { Send, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Entry } from '../api/entries-api'
import { usePublishEntry, useUnpublishEntry } from '../api/entries-api'

type EntriesBulkActionsProps<TData> = {
  table: Table<TData>
}

export function EntriesBulkActions<TData>({ table }: EntriesBulkActionsProps<TData>) {
  const [isProcessing, setIsProcessing] = useState(false)
  const publishEntry = usePublishEntry()
  const unpublishEntry = useUnpublishEntry()

  const selectedRows = table.getFilteredSelectedRowModel().rows
  const selectedEntries = selectedRows.map((r) => r.original as unknown as Entry)

  const handleBulkPublish = async () => {
    if (selectedEntries.length === 0) return
    setIsProcessing(true)
    const toastId = toast.loading(`Publishing ${selectedEntries.length} entries...`)
    try {
      let succeeded = 0
      for (const entry of selectedEntries) {
        if (entry.status !== 'published') {
          await publishEntry.mutateAsync(entry.id)
          succeeded++
        }
      }
      toast.success(`Published ${succeeded} entry${succeeded !== 1 ? 's' : ''}`, { id: toastId })
      table.resetRowSelection()
    } catch {
      toast.error('Failed to complete bulk publish', { id: toastId })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleBulkUnpublish = async () => {
    if (selectedEntries.length === 0) return
    setIsProcessing(true)
    const toastId = toast.loading(`Unpublishing ${selectedEntries.length} entries...`)
    try {
      let succeeded = 0
      for (const entry of selectedEntries) {
        if (entry.status === 'published') {
          await unpublishEntry.mutateAsync(entry.id)
          succeeded++
        }
      }
      toast.success(`Unpublished ${succeeded} entry${succeeded !== 1 ? 's' : ''}`, { id: toastId })
      table.resetRowSelection()
    } catch {
      toast.error('Failed to complete bulk unpublish', { id: toastId })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <BulkActionsToolbar table={table} entityName='entry'>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='outline'
            size='sm'
            className='h-8'
            onClick={handleBulkPublish}
            disabled={isProcessing}
          >
            <Send className='mr-1.5 size-3.5 text-green-600' />
            Publish
          </Button>
        </TooltipTrigger>
        <TooltipContent>Publish selected entries</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='outline'
            size='sm'
            className='h-8'
            onClick={handleBulkUnpublish}
            disabled={isProcessing}
          >
            <Undo2 className='mr-1.5 size-3.5 text-amber-600' />
            Unpublish
          </Button>
        </TooltipTrigger>
        <TooltipContent>Unpublish selected entries back to draft</TooltipContent>
      </Tooltip>
    </BulkActionsToolbar>
  )
}
