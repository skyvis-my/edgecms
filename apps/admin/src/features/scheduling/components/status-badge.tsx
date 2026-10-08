import { Badge } from '@/components/ui/badge'
import type { EntryStatus } from '@/features/entries/api/entries-api'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'

/**
 * Status badge colors mapping
 */
const statusColors: Record<EntryStatus, string> = {
  draft: 'border-gray-500 text-gray-600 dark:border-gray-400 dark:text-gray-400',
  scheduled: 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400',
  published: 'border-green-500 text-green-600 dark:border-green-400 dark:text-green-400',
  archived: 'border-yellow-500 text-yellow-600 dark:border-yellow-400 dark:text-yellow-400',
}

type StatusBadgeProps = {
  status: EntryStatus
  scheduledDate?: string | null
  className?: string
}

/**
 * StatusBadge component displays a color-coded badge for entry status
 * For 'scheduled' status, it also shows the scheduled date/time
 */
export function StatusBadge({ status, scheduledDate, className }: StatusBadgeProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Badge variant='outline' className={cn(statusColors[status])}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
      {status === 'scheduled' && scheduledDate && (
        <span
          className='text-xs text-muted-foreground'
          title={toBrowserDateTime(scheduledDate) ?? undefined}
        >
          {toRelativeTime(scheduledDate)}
        </span>
      )}
    </div>
  )
}
