import { Link, useLocation } from '@tanstack/react-router'
import type { Row } from '@tanstack/react-table'
import { Copy, Pencil, Send, Trash, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getCurrentTenantSlug } from '@/features/tenants/api'
import type { Entry } from '../api/entries-api'
import {
  useCancelSchedule,
  useDuplicateEntry,
  usePublishEntry,
  useUnpublishEntry,
} from '../api/entries-api'
import { useEntriesContext } from './entries-provider'

type EntriesRowActionsProps = {
  row: Row<Entry>
}

export function EntriesRowActions({ row }: EntriesRowActionsProps) {
  const { setDeleteDialogOpen } = useEntriesContext()
  const duplicateEntry = useDuplicateEntry()
  const publishEntry = usePublishEntry()
  const unpublishEntry = useUnpublishEntry()
  const cancelSchedule = useCancelSchedule()

  const entry = row.original
  const { pathname } = useLocation()
  const collectionSlug = pathname.split('/collections/')[1]?.split('/entries')[0]
  const tenantSlug = getCurrentTenantSlug()
  const editEntryPath = tenantSlug
    ? `/tenants/${tenantSlug}/collections/${collectionSlug ?? entry.collectionId}/entries/${entry.slug}`
    : '/admin/tenants'

  const handleDuplicate = () => {
    duplicateEntry.mutate(entry.id, {
      onSuccess: () => toast.success('Entry duplicated successfully'),
      onError: () => toast.error('Failed to duplicate entry'),
    })
  }

  const handlePublish = () => {
    publishEntry.mutate(entry.id, {
      onSuccess: () => toast.success('Entry published successfully'),
      onError: () => toast.error('Failed to publish entry'),
    })
  }

  const handleUnpublish = () => {
    unpublishEntry.mutate(entry.id, {
      onSuccess: () => toast.success('Entry unpublished (moved to draft)'),
      onError: () => toast.error('Failed to unpublish entry'),
    })
  }

  const handleCancelSchedule = () => {
    cancelSchedule.mutate(entry.id, {
      onSuccess: () => toast.success('Schedule cancelled'),
      onError: () => toast.error('Failed to cancel schedule'),
    })
  }

  const isPending =
    duplicateEntry.isPending ||
    publishEntry.isPending ||
    unpublishEntry.isPending ||
    cancelSchedule.isPending

  const hasScheduledTransition =
    entry.status === 'scheduled' || (entry.status === 'published' && Boolean(entry.unpublishAt))

  return (
    <div className='flex items-center justify-end gap-1.5'>
      <Button variant='outline' size='sm' asChild>
        <Link to={editEntryPath}>
          <Pencil className='mr-1.5 size-3.5' />
          Edit
        </Link>
      </Button>

      {entry.status === 'published' ? (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={handleUnpublish}
          disabled={isPending}
          title='Unpublish entry back to draft'
        >
          <Undo2 className='mr-1.5 size-3.5' />
          Unpublish
        </Button>
      ) : (
        <Button
          type='button'
          variant='secondary'
          size='sm'
          onClick={handlePublish}
          disabled={isPending}
          title='Publish entry immediately'
        >
          <Send className='mr-1.5 size-3.5' />
          Publish
        </Button>
      )}

      {hasScheduledTransition && (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={handleCancelSchedule}
          disabled={isPending}
          title='Cancel scheduled transition'
        >
          <X className='mr-1.5 size-3.5 text-destructive' />
          Cancel Schedule
        </Button>
      )}

      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={handleDuplicate}
        disabled={isPending}
        title='Duplicate entry'
      >
        <Copy className='mr-1.5 size-3.5' />
        Duplicate
      </Button>

      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={() => setDeleteDialogOpen(entry.id)}
        disabled={isPending}
        title='Delete entry'
      >
        <Trash className='mr-1.5 size-3.5 text-destructive' />
        Delete
      </Button>
    </div>
  )
}
