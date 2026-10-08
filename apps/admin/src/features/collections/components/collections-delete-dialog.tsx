import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useDeleteCollection } from '../api/collections-api'
import { useCollectionsContext } from './collections-provider'

export function CollectionsDeleteDialog() {
  const { deleteDialogOpen, setDeleteDialogOpen } = useCollectionsContext()
  const deleteMutation = useDeleteCollection()

  const handleDelete = async () => {
    if (!deleteDialogOpen) return

    try {
      await deleteMutation.mutateAsync(deleteDialogOpen)
      toast.success('Collection deleted successfully')
      setDeleteDialogOpen(null)
    } catch {
      toast.error('Failed to delete collection')
    }
  }

  return (
    <AlertDialog open={!!deleteDialogOpen} onOpenChange={() => setDeleteDialogOpen(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this collection and all of its entries. This action cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
