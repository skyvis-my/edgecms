import { Link, useLocation } from '@tanstack/react-router'
import type { Row } from '@tanstack/react-table'
import { Copy, Pencil, Trash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getCurrentTenantSlug } from '@/features/tenants/api'
import type { Entry } from '../api/entries-api'
import { useDuplicateEntry } from '../api/entries-api'
import { useEntriesContext } from './entries-provider'

type EntriesRowActionsProps = {
  row: Row<Entry>
}

export function EntriesRowActions({ row }: EntriesRowActionsProps) {
  const { setDeleteDialogOpen } = useEntriesContext()
  const duplicateEntry = useDuplicateEntry()
  const entry = row.original
  const { pathname } = useLocation()
  const collectionSlug = pathname.split('/collections/')[1]?.split('/entries')[0]
  const tenantSlug = getCurrentTenantSlug()
  const editEntryPath = tenantSlug
    ? `/tenants/${tenantSlug}/collections/${collectionSlug ?? entry.collectionId}/entries/${entry.slug}`
    : '/admin/tenants'

  const handleDuplicate = () => {
    duplicateEntry.mutate(entry.id)
  }

  return (
    <div className='flex items-center justify-end gap-2'>
      <Button variant='outline' size='sm' asChild>
        <Link to={editEntryPath}>
          <Pencil className='mr-2 size-4' />
          Edit
        </Link>
      </Button>
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={handleDuplicate}
        disabled={duplicateEntry.isPending}
      >
        <Copy className='mr-2 size-4' />
        Duplicate
      </Button>
      <Button
        type='button'
        variant='outline'
        size='sm'
        onClick={() => setDeleteDialogOpen(entry.id)}
      >
        <Trash className='mr-2 size-4' />
        Delete
      </Button>
    </div>
  )
}
