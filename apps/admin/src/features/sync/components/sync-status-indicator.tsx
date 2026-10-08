import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Check, Loader2, WifiOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import { triggerSync } from '../sync-scheduler'
import { useSyncStore } from '../sync-store'
import { logger } from '@/lib/logger'

/**
 * Sync Status Indicator Component
 *
 * Displays sync state in the admin header with:
 * - Visual status icon (check, spinner, offline, error)
 * - Conflict/pending badges
 * - Tooltip with details
 * - Click to sync or navigate to conflicts
 */
export function SyncStatusIndicator() {
  const navigate = useNavigate()
  const { status, lastSyncAt, conflictCount, pendingCount, error } = useSyncStore()

  const handleClick = async () => {
    if (conflictCount > 0) {
      // Navigate to conflict resolution page
      navigate({ to: '/sync' })
    } else if (status !== 'syncing') {
      // Trigger manual sync
      try {
        await triggerSync()
      } catch (err) {
        logger.error('Manual sync failed:', err)
      }
    }
  }

  const getStatusIcon = () => {
    switch (status) {
      case 'syncing':
        return <Loader2 className='size-4 animate-spin text-blue-500' />
      case 'offline':
        return <WifiOff className='size-4 text-muted-foreground' />
      case 'error':
        return <AlertTriangle className='size-4 text-yellow-500' />
      default:
        return <Check className='size-4 text-green-500' />
    }
  }

  const getStatusText = () => {
    switch (status) {
      case 'syncing':
        return 'Syncing...'
      case 'offline':
        return 'Offline'
      case 'error':
        return `Error: ${error || 'Unknown error'}`
      default:
        return lastSyncAt ? `Last synced: ${toRelativeTime(lastSyncAt)}` : 'Ready to sync'
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            onClick={handleClick}
            aria-label={conflictCount > 0 ? 'Open sync conflicts' : 'Run sync now'}
            className={cn(
              'relative',
              status === 'syncing' && 'cursor-wait',
              conflictCount > 0 && 'ring-2 ring-red-500'
            )}
            disabled={status === 'syncing'}
          >
            {getStatusIcon()}

            {/* Conflict badge */}
            {conflictCount > 0 && (
              <Badge
                variant='destructive'
                className='absolute -right-1 -top-1 size-5 rounded-full p-0 text-[10px] font-bold flex items-center justify-center'
              >
                {conflictCount}
              </Badge>
            )}

            {/* Pending badge */}
            {pendingCount > 0 && conflictCount === 0 && (
              <Badge
                variant='secondary'
                className='absolute -right-1 -top-1 size-5 rounded-full p-0 text-[10px] font-bold flex items-center justify-center'
              >
                {pendingCount}
              </Badge>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className='space-y-1 text-sm'>
            <p className='font-medium'>{getStatusText()}</p>
            {lastSyncAt && (
              <p
                className='text-muted-foreground'
                title={toBrowserDateTime(lastSyncAt) ?? undefined}
              >
                {toBrowserDateTime(lastSyncAt)}
              </p>
            )}
            {conflictCount > 0 && (
              <p className='text-red-400'>
                {conflictCount} conflict{conflictCount > 1 ? 's' : ''} - click to resolve
              </p>
            )}
            {pendingCount > 0 && (
              <p className='text-muted-foreground'>
                {pendingCount} pending change{pendingCount > 1 ? 's' : ''}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
