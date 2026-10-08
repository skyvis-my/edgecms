import { Link } from '@tanstack/react-router'
import type { Row } from '@tanstack/react-table'
import { FileText, MoreHorizontal, Pencil, Trash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getCurrentTenantSlug } from '@/features/tenants/api'
import type { CollectionDefinition } from '../api/collections-api'
import { useCollectionsContext } from './collections-provider'

type CollectionsRowActionsProps = {
  row: Row<CollectionDefinition>
}

export function CollectionsRowActions({ row }: CollectionsRowActionsProps) {
  const { setDeleteDialogOpen } = useCollectionsContext()
  const collection = row.original
  const tenantSlug = getCurrentTenantSlug()
  const entriesPath = tenantSlug
    ? `/tenants/${tenantSlug}/collections/${collection.slug}/entries`
    : '/admin/tenants'
  const editPath = tenantSlug
    ? `/tenants/${tenantSlug}/collections/${collection.id}`
    : '/admin/tenants'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' className='flex size-8 p-0 data-[state=open]:bg-muted'>
          <MoreHorizontal className='size-4' />
          <span className='sr-only'>Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-40'>
        <DropdownMenuItem asChild>
          <Link to={entriesPath}>
            <FileText className='mr-2 size-4' />
            Entries
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={editPath}>
            <Pencil className='mr-2 size-4' />
            Edit
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setDeleteDialogOpen(collection.id)}
          className='text-red-600 focus:text-red-600'
        >
          <Trash className='mr-2 size-4' />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
