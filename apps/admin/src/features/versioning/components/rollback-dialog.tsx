import { AlertCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { useRollback, useVersion } from '../api'

type RollbackDialogProps = {
  entryId: string
  version: {
    id: string
    version: number
    timestamp: string
  } | null
  onClose: () => void
}

/**
 * Confirmation dialog for rolling back to a previous version
 */
export function RollbackDialog({ entryId, version, onClose }: RollbackDialogProps) {
  const rollbackMutation = useRollback()
  const { data: versionData } = useVersion(entryId, version?.id || '')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (version) {
      setErrorMessage(null)
    }
  }, [version])

  const handleRollback = async () => {
    if (!version) return

    try {
      await rollbackMutation.mutateAsync({
        entryId,
        versionId: version.id,
      })
      setErrorMessage(null)
      toast.success(`Rolled back to version ${version.version}`)
      onClose()
    } catch (error) {
      logger.error('Rollback error:', error)
      setErrorMessage('Failed to rollback. Please try again.')
      toast.error('Failed to rollback. Please try again.')
    }
  }

  return (
    <Dialog open={!!version} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rollback to Version {version?.version}</DialogTitle>
          <DialogDescription>Are you sure you want to rollback to this version?</DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-4'>
          <Alert>
            <AlertCircle className='size-4' />
            <AlertDescription>
              This will create a new version with the data from version {version?.version}. No data
              will be deleted.
            </AlertDescription>
          </Alert>

          {version && (
            <div className='space-y-2'>
              <div className='text-sm'>
                <span className='font-medium'>Version:</span> {version.version}
              </div>
              <div className='text-sm'>
                <span className='font-medium'>Date:</span>{' '}
                <span title={toBrowserDateTime(version.timestamp) ?? undefined}>
                  {toRelativeTime(version.timestamp)}
                </span>
              </div>
            </div>
          )}

          {versionData && (
            <div className='space-y-2'>
              <div className='text-sm font-medium'>Preview:</div>
              <div className='bg-muted p-3 rounded-md max-h-[200px] overflow-y-auto'>
                <div className='space-y-1 text-xs font-mono'>
                  <div>
                    <span className='text-muted-foreground'>Slug:</span> {versionData.slug}
                  </div>
                  <div>
                    <span className='text-muted-foreground'>Status:</span> {versionData.status}
                  </div>
                  <div>
                    <span className='text-muted-foreground'>Data:</span>
                    <pre className='mt-1 text-xs'>{JSON.stringify(versionData.data, null, 2)}</pre>
                  </div>
                </div>
              </div>
            </div>
          )}

          {errorMessage && (
            <Alert variant='destructive'>
              <AlertCircle className='size-4' />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onClose} disabled={rollbackMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleRollback} disabled={rollbackMutation.isPending}>
            {rollbackMutation.isPending ? 'Rolling back...' : 'Confirm Rollback'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
