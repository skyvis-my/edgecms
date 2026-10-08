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
import { useDeleteEntry } from '../api/entries-api'
import { useEntriesContext } from './entries-provider'

export function EntriesDeleteDialog() {
  const { deleteDialogOpen, setDeleteDialogOpen } = useEntriesContext()
  const deleteMutation = useDeleteEntry()

  const handleDelete = async () => {
    if (!deleteDialogOpen) return

    try {
      await deleteMutation.mutateAsync(deleteDialogOpen)
      toast.success('Entry deleted successfully')
      setDeleteDialogOpen(null)
    } catch {
      toast.error('Failed to delete entry')
    }
  }

  return (
    <AlertDialog open={!!deleteDialogOpen} onOpenChange={() => setDeleteDialogOpen(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this entry. This action cannot be undone.
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
