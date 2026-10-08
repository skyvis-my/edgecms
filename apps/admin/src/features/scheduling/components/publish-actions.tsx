import { Calendar, Clock, Send, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
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
import { Button } from '@/components/ui/button'
import {
  buildCancelScheduleCommand,
  buildPublishNowCommand,
  buildSchedulePublishCommand,
  buildScheduleUnpublishCommand,
  buildUpdateEntryCommand,
  buildUnpublishNowCommand,
  type CommandEnvelope,
} from '@/features/commands/command-builder'
import { useExecuteCommand } from '@/features/commands/use-execute-command'
import type { EntryStatus } from '@/features/entries/api/entries-api'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'

function formatDateForDialog(value: Date): string {
  const browserDateTime = toBrowserDateTime(value)
  if (!browserDateTime) return '-'
  return `${toRelativeTime(value)} (${browserDateTime})`
}



type PublishActionsProps = {
  entryId: string
  collectionSlug?: string
  currentStatus: EntryStatus
  publishAt?: Date | null
  unpublishAt?: Date | null
  onSuccess?: () => void
  disabled?: boolean
}

/**
 * PublishActions component displays action buttons based on entry status
 * and handles publish/unpublish/schedule operations with confirmations
 */
export function PublishActions({
  entryId,
  currentStatus,
  publishAt,
  unpublishAt,
  onSuccess,
  disabled = false,
}: PublishActionsProps) {
  const [confirmAction, setConfirmAction] = useState<string | null>(null)
  const executeCommand = useExecuteCommand()

  const handleAction = async (action: string, command: CommandEnvelope) => {
    try {
      await executeCommand.mutateAsync(command)
      toast.success(`${action} successful`)
      onSuccess?.()
    } catch (error) {
      logger.error(`${action} error:`, error)
      // Error toast is already handled by useExecuteCommand
    } finally {
      setConfirmAction(null)
    }
  }

  const renderActions = () => {
    switch (currentStatus) {
      case 'draft':
        return (
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              onClick={() => setConfirmAction('publishNow')}
              disabled={disabled}
              size='sm'
            >
              <Send className='mr-2 h-4 w-4' />
              Publish Now
            </Button>
            {publishAt && (
              <Button
                type='button'
                variant='secondary'
                onClick={() => setConfirmAction('schedule')}
                disabled={disabled}
                size='sm'
              >
                <Clock className='mr-2 h-4 w-4' />
                Schedule
              </Button>
            )}
          </div>
        )

      case 'scheduled':
        return (
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              onClick={() => setConfirmAction('publishNow')}
              disabled={disabled}
              size='sm'
            >
              <Send className='mr-2 h-4 w-4' />
              Publish Now
            </Button>
            <Button
              type='button'
              variant='destructive'
              onClick={() => setConfirmAction('cancelSchedule')}
              disabled={disabled}
              size='sm'
            >
              <X className='mr-2 h-4 w-4' />
              Cancel Schedule
            </Button>
          </div>
        )

      case 'published':
        return (
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              variant='secondary'
              onClick={() => setConfirmAction('unpublish')}
              disabled={disabled}
              size='sm'
            >
              <Trash2 className='mr-2 h-4 w-4' />
              Unpublish
            </Button>
            {unpublishAt && (
              <Button
                type='button'
                variant='outline'
                onClick={() => setConfirmAction('scheduleUnpublish')}
                disabled={disabled}
                size='sm'
              >
                <Calendar className='mr-2 h-4 w-4' />
                Schedule Unpublish
              </Button>
            )}
          </div>
        )

      case 'archived':
        return (
          <Button
            type='button'
            variant='outline'
            onClick={() => setConfirmAction('revertToDraft')}
            disabled={disabled}
            size='sm'
          >
            Revert to Draft
          </Button>
        )

      default:
        return null
    }
  }

  const getConfirmationDialog = () => {
    if (!confirmAction) return null

    const dialogs: Record<string, { title: string; description: string; action: () => void }> = {
      publishNow: {
        title: 'Publish Entry Now',
        description: 'Are you sure you want to publish this entry immediately?',
        action: () => handleAction('Publish', buildPublishNowCommand(entryId)),
      },
      schedule: {
        title: 'Schedule Publication',
        description: publishAt
          ? `Schedule this entry to be published ${formatDateForDialog(publishAt)}?`
          : 'Please set a publish date first.',
        action: () => {
          if (publishAt) {
            handleAction(
              'Schedule',
              buildSchedulePublishCommand(entryId, publishAt.toISOString())
            )
          }
        },
      },
      cancelSchedule: {
        title: 'Cancel Schedule',
        description: 'Are you sure you want to cancel the scheduled publication?',
        action: () =>
          handleAction('Cancel schedule', buildCancelScheduleCommand(entryId)),
      },
      unpublish: {
        title: 'Unpublish Entry',
        description: 'Are you sure you want to unpublish this entry immediately?',
        action: () => handleAction('Unpublish', buildUnpublishNowCommand(entryId)),
      },
      scheduleUnpublish: {
        title: 'Schedule Unpublication',
        description: unpublishAt
          ? `Schedule this entry to be unpublished ${formatDateForDialog(unpublishAt)}?`
          : 'Please set an unpublish date first.',
        action: () => {
          if (unpublishAt) {
            handleAction(
              'Schedule unpublish',
              buildScheduleUnpublishCommand(entryId, unpublishAt.toISOString())
            )
          }
        },
      },
      revertToDraft: {
        title: 'Revert to Draft',
        description: 'This will move the archived entry back to draft so editors can update it before publishing.',
        action: () =>
          handleAction('Revert to draft', buildUpdateEntryCommand(entryId, undefined, undefined, 'draft')),
      },
    }

    const dialog = dialogs[confirmAction]

    return (
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={dialog.action}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <div>
      {renderActions()}
      {getConfirmationDialog()}
    </div>
  )
}
