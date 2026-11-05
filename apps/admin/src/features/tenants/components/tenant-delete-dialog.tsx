import { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { logger } from '@/lib/logger'
import {
  fetchTenantExport,
  saveTenantExport,
  type TenantDeletionJob,
  useCancelTenantDeletion,
  useConfirmTenantDeletion,
  useRequestTenantDeletion,
  useResumeTenantDeletion,
} from '../offboarding-api'

type TenantDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenant: { slug: string; name: string }
  /** Called once the deletion job reports `completed`. */
  onDeleted: () => void
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * HS-09 tenant deletion: request (suspends the tenant), export, then type the
 * tenant slug to confirm. Nothing is deleted before the confirmation.
 */
export function TenantDeleteDialog({ open, onOpenChange, tenant, onDeleted }: TenantDeleteDialogProps) {
  const requestMutation = useRequestTenantDeletion()
  const confirmMutation = useConfirmTenantDeletion()
  const resumeMutation = useResumeTenantDeletion()
  const cancelMutation = useCancelTenantDeletion()

  const [job, setJob] = useState<TenantDeletionJob | null>(null)
  const [exportId, setExportId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [typedSlug, setTypedSlug] = useState('')

  const busy =
    requestMutation.isPending ||
    confirmMutation.isPending ||
    resumeMutation.isPending ||
    cancelMutation.isPending ||
    exporting
  const slugMatches = typedSlug === tenant.slug
  const confirmed = job?.status === 'confirmed'

  const reset = () => {
    setJob(null)
    setExportId(null)
    setTypedSlug('')
  }

  const settle = (next: TenantDeletionJob) => {
    setJob(next)
    if (next.done) {
      toast.success(`Tenant "${tenant.name}" deleted`)
      reset()
      onOpenChange(false)
      onDeleted()
    }
  }

  const handleRequest = async () => {
    try {
      settle(await requestMutation.mutateAsync(tenant.slug))
    } catch (error) {
      logger.error('Request tenant deletion error:', error)
      toast.error(errorMessage(error, 'Failed to request deletion'))
    }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const file = await fetchTenantExport(tenant.slug)
      saveTenantExport(file)
      setExportId(file.exportId)
    } catch (error) {
      logger.error('Tenant export error:', error)
      toast.error(errorMessage(error, 'Failed to export tenant'))
    } finally {
      setExporting(false)
    }
  }

  const handleConfirm = async () => {
    if (!job || !exportId || !slugMatches) return
    try {
      settle(await confirmMutation.mutateAsync({ jobId: job.id, tenantSlug: typedSlug, exportId }))
    } catch (error) {
      logger.error('Confirm tenant deletion error:', error)
      toast.error(errorMessage(error, 'Failed to delete tenant'))
    }
  }

  const handleResume = async () => {
    if (!job) return
    try {
      settle(await resumeMutation.mutateAsync(job.id))
    } catch (error) {
      logger.error('Resume tenant deletion error:', error)
      toast.error(errorMessage(error, 'Failed to continue deletion'))
    }
  }

  const handleCancelRequest = async () => {
    if (!job) return
    try {
      await cancelMutation.mutateAsync(job.id)
      toast.success('Deletion request cancelled')
      reset()
      onOpenChange(false)
    } catch (error) {
      logger.error('Cancel tenant deletion error:', error)
      toast.error(errorMessage(error, 'Failed to cancel deletion request'))
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete tenant</AlertDialogTitle>
          <AlertDialogDescription>
            Deleting &quot;{tenant.name}&quot; removes all of its content, assets, users&apos;
            memberships and settings. Nothing is deleted until you confirm the last step.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ol className='space-y-4 text-sm'>
          <li className='space-y-2'>
            <p className='font-medium'>1. Request deletion</p>
            <p className='text-muted-foreground'>
              This suspends an active tenant so no more admin changes are made. You can still
              cancel.
            </p>
            {job ? (
              <p data-testid='tenant-deletion-job'>Request open ({job.status}).</p>
            ) : (
              <Button type='button' variant='outline' onClick={handleRequest} disabled={busy}>
                {requestMutation.isPending ? 'Requesting...' : 'Request deletion'}
              </Button>
            )}
          </li>

          <li className='space-y-2'>
            <p className='font-medium'>2. Download an export</p>
            <p className='text-muted-foreground'>
              Keep this file. It is the only copy of the tenant&apos;s data after deletion.
            </p>
            {exportId ? (
              <p>
                Export saved: <code className='rounded bg-muted px-1 text-xs'>{exportId}</code>
              </p>
            ) : (
              <Button
                type='button'
                variant='outline'
                onClick={handleExport}
                disabled={busy || !job || confirmed}
              >
                {exporting ? 'Exporting...' : 'Download export'}
              </Button>
            )}
          </li>

          <li className='space-y-2'>
            <Label htmlFor='tenant-delete-confirm-slug' className='font-medium'>
              3. Type <code className='rounded bg-muted px-1 text-xs'>{tenant.slug}</code> to
              confirm
            </Label>
            <Input
              id='tenant-delete-confirm-slug'
              autoComplete='off'
              value={typedSlug}
              onChange={(event) => setTypedSlug(event.target.value)}
              disabled={busy || !job || !exportId || confirmed}
            />
          </li>
        </ol>

        {confirmed && (
          <p className='text-sm text-muted-foreground'>
            Deletion started but has not finished
            {job?.lastError ? ` (${job.lastError})` : ''}. Continue to finish it.
          </p>
        )}

        <AlertDialogFooter>
          {job?.status === 'requested' ? (
            <Button type='button' variant='outline' onClick={handleCancelRequest} disabled={busy}>
              Cancel request
            </Button>
          ) : (
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Close
            </Button>
          )}
          {confirmed ? (
            <Button type='button' variant='destructive' onClick={handleResume} disabled={busy}>
              {resumeMutation.isPending ? 'Deleting...' : 'Continue deletion'}
            </Button>
          ) : (
            <Button
              type='button'
              variant='destructive'
              onClick={handleConfirm}
              disabled={busy || !job || !exportId || !slugMatches}
            >
              {confirmMutation.isPending ? 'Deleting...' : 'Delete permanently'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
