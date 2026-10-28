import { Clock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import type { Entry } from '../api/entries-api'

type EntrySchedulingPanelProps = {
  entry: Entry
  scheduledPublishAt: string
  setScheduledPublishAt: (val: string) => void
  scheduledUnpublishAt: string
  setScheduledUnpublishAt: (val: string) => void
  onSchedulePublish: () => void
  onScheduleUnpublish: () => void
  onCancelSchedule: () => void
  isPublishPending: boolean
  isUnpublishPending: boolean
  isCancelPending: boolean
}

function formatPreset(hoursAhead: number): string {
  const d = new Date(Date.now() + hoursAhead * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function EntrySchedulingPanel({
  entry,
  scheduledPublishAt,
  setScheduledPublishAt,
  scheduledUnpublishAt,
  setScheduledUnpublishAt,
  onSchedulePublish,
  onScheduleUnpublish,
  onCancelSchedule,
  isPublishPending,
  isUnpublishPending,
  isCancelPending,
}: EntrySchedulingPanelProps) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const hasActiveSchedule =
    entry.status === 'scheduled' || Boolean(entry.unpublishAt)

  return (
    <Card data-testid='scheduling-panel' className='border-primary/20 bg-muted/40'>
      <CardContent className='space-y-4 p-4'>
        <div className='flex items-center justify-between'>
          <h4 className='text-sm font-semibold flex items-center gap-2'>
            <Clock className='size-4 text-primary' />
            Scheduled Publishing & Unpublishing
          </h4>
          {hasActiveSchedule && (
            <Button
              type='button'
              variant='destructive'
              size='sm'
              className='h-7 text-xs'
              disabled={isCancelPending}
              onClick={onCancelSchedule}
            >
              <X className='mr-1 size-3' />
              Cancel Active Schedule
            </Button>
          )}
        </div>

        {/* Active schedule notification banners */}
        {entry.status === 'scheduled' && entry.publishAt && (
          <div className='rounded border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-300 flex items-center justify-between'>
            <span>
              <strong>Active Schedule:</strong> Scheduled to publish{' '}
              {toRelativeTime(entry.publishAt)} (
              {toBrowserDateTime(entry.publishAt)})
            </span>
          </div>
        )}

        {entry.status === 'published' && entry.unpublishAt && (
          <div className='rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between'>
            <span>
              <strong>Active Schedule:</strong> Scheduled to unpublish{' '}
              {toRelativeTime(entry.unpublishAt)} (
              {toBrowserDateTime(entry.unpublishAt)})
            </span>
          </div>
        )}

        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='schedule-publish-at' className='text-xs'>
                Publish Date & Time
              </Label>
              <div className='flex gap-1 text-[10px] text-muted-foreground'>
                <button
                  type='button'
                  className='hover:underline hover:text-foreground'
                  onClick={() => setScheduledPublishAt(formatPreset(1))}
                >
                  +1h
                </button>
                <span>•</span>
                <button
                  type='button'
                  className='hover:underline hover:text-foreground'
                  onClick={() => setScheduledPublishAt(formatPreset(24))}
                >
                  +24h
                </button>
              </div>
            </div>
            <div className='flex gap-2'>
              <Input
                id='schedule-publish-at'
                type='datetime-local'
                value={scheduledPublishAt}
                onChange={(e) => setScheduledPublishAt(e.target.value)}
                className='h-8 text-xs'
              />
              <Button
                type='button'
                size='sm'
                className='h-8 text-xs'
                disabled={!scheduledPublishAt || isPublishPending}
                onClick={onSchedulePublish}
              >
                {isPublishPending ? 'Scheduling...' : 'Schedule'}
              </Button>
            </div>
            <p className='text-[10px] text-muted-foreground'>Timezone: {timeZone}</p>
          </div>

          {entry.status === 'published' && (
            <div className='space-y-1.5'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='schedule-unpublish-at' className='text-xs'>
                  Unpublish Date & Time
                </Label>
                <div className='flex gap-1 text-[10px] text-muted-foreground'>
                  <button
                    type='button'
                    className='hover:underline hover:text-foreground'
                    onClick={() => setScheduledUnpublishAt(formatPreset(24))}
                  >
                    +24h
                  </button>
                  <span>•</span>
                  <button
                    type='button'
                    className='hover:underline hover:text-foreground'
                    onClick={() => setScheduledUnpublishAt(formatPreset(168))}
                  >
                    +7d
                  </button>
                </div>
              </div>
              <div className='flex gap-2'>
                <Input
                  id='schedule-unpublish-at'
                  type='datetime-local'
                  value={scheduledUnpublishAt}
                  onChange={(e) => setScheduledUnpublishAt(e.target.value)}
                  className='h-8 text-xs'
                />
                <Button
                  type='button'
                  size='sm'
                  className='h-8 text-xs'
                  disabled={!scheduledUnpublishAt || isUnpublishPending}
                  onClick={onScheduleUnpublish}
                >
                  {isUnpublishPending ? 'Scheduling...' : 'Schedule'}
                </Button>
              </div>
              <p className='text-[10px] text-muted-foreground'>Timezone: {timeZone}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
