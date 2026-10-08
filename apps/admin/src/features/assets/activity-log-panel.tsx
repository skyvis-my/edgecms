import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toRelativeTime } from '@/lib/date-time'
import type { MediaActivity, MediaActivityStatus } from './media-manager-types'

type ActivityLogPanelProps = {
  activityLog: MediaActivity[]
  onClear: () => void
}

const getActivityBadgeVariant = (
  status: MediaActivityStatus
): 'outline' | 'secondary' | 'destructive' => {
  if (status === 'error') return 'destructive'
  if (status === 'queued') return 'secondary'
  return 'outline'
}

export function ActivityLogPanel({
  activityLog,
  onClear,
}: ActivityLogPanelProps) {
  return (
    <div className='rounded-md border bg-muted/20 p-3'>
      <div className='mb-2 flex items-center justify-between'>
        <div className='text-sm font-medium'>Recent Activity</div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={activityLog.length === 0}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
      {activityLog.length === 0 ? (
        <div className='text-xs text-muted-foreground'>
          No operations recorded for this session.
        </div>
      ) : (
        <div className='space-y-2'>
          {activityLog.map((activity) => (
            <div
              key={activity.id}
              className='flex items-center justify-between rounded border bg-background p-2'
            >
              <div>
                <div className='text-sm font-medium'>
                  {activity.title}
                </div>
                <div className='text-xs text-muted-foreground'>
                  {activity.detail}
                </div>
              </div>
              <div className='flex items-center gap-2'>
                <Badge
                  variant={getActivityBadgeVariant(activity.status)}
                >
                  {activity.status}
                </Badge>
                <span className='text-xs text-muted-foreground'>
                  {toRelativeTime(activity.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
