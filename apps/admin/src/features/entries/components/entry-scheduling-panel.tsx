import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  return (
    <Card data-testid='scheduling-panel' className='border-primary/20 bg-muted/40'>
      <CardContent className='space-y-4 p-4'>
        <div className='flex items-center justify-between'>
          <h4 className='text-sm font-semibold flex items-center gap-2'>
            <Clock className='size-4 text-primary' />
            Scheduled Publishing & Unpublishing
          </h4>
          {entry.status === 'scheduled' && (
            <Button
              type='button'
              variant='destructive'
              size='sm'
              className='h-7 text-xs'
              disabled={isCancelPending}
              onClick={onCancelSchedule}
            >
              Cancel Active Schedule
            </Button>
          )}
        </div>

        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='schedule-publish-at' className='text-xs'>
              Publish Date & Time
            </Label>
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
                Schedule
              </Button>
            </div>
          </div>

          {entry.status === 'published' && (
            <div className='space-y-1.5'>
              <Label htmlFor='schedule-unpublish-at' className='text-xs'>
                Unpublish Date & Time
              </Label>
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
                  Schedule
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
