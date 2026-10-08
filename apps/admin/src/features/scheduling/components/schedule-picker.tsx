import { format } from 'date-fns'
import { Calendar as CalendarIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type SchedulePickerProps = {
  publishAt?: Date | null
  unpublishAt?: Date | null
  onPublishAtChange: (date: Date | null) => void
  onUnpublishAtChange: (date: Date | null) => void
  disabled?: boolean
}

/**
 * SchedulePicker component provides date/time pickers for scheduling
 * entry publication and unpublication times
 */
export function SchedulePicker({
  publishAt,
  unpublishAt,
  onPublishAtChange,
  onUnpublishAtChange,
  disabled = false,
}: SchedulePickerProps) {
  const handlePublishDateSelect = (date: Date | undefined) => {
    if (!date) {
      onPublishAtChange(null)
      return
    }

    // If we have an existing publishAt time, preserve it
    if (publishAt) {
      const newDate = new Date(date)
      newDate.setHours(publishAt.getHours(), publishAt.getMinutes(), 0, 0)
      onPublishAtChange(newDate)
    } else {
      // Default to current time
      const now = new Date()
      date.setHours(now.getHours(), now.getMinutes(), 0, 0)
      onPublishAtChange(date)
    }
  }

  const handlePublishTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const timeValue = e.target.value
    if (!timeValue) return

    const [hours, minutes] = timeValue.split(':').map(Number)
    const newDate = publishAt ? new Date(publishAt) : new Date()
    newDate.setHours(hours, minutes, 0, 0)
    onPublishAtChange(newDate)
  }

  const handleUnpublishDateSelect = (date: Date | undefined) => {
    if (!date) {
      onUnpublishAtChange(null)
      return
    }

    // If we have an existing unpublishAt time, preserve it
    if (unpublishAt) {
      const newDate = new Date(date)
      newDate.setHours(unpublishAt.getHours(), unpublishAt.getMinutes(), 0, 0)
      onUnpublishAtChange(newDate)
    } else {
      // Default to current time
      const now = new Date()
      date.setHours(now.getHours(), now.getMinutes(), 0, 0)
      onUnpublishAtChange(date)
    }
  }

  const handleUnpublishTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const timeValue = e.target.value
    if (!timeValue) return

    const [hours, minutes] = timeValue.split(':').map(Number)
    const newDate = unpublishAt ? new Date(unpublishAt) : new Date()
    newDate.setHours(hours, minutes, 0, 0)
    onUnpublishAtChange(newDate)
  }

  const clearPublishAt = () => {
    onPublishAtChange(null)
  }

  const clearUnpublishAt = () => {
    onUnpublishAtChange(null)
  }

  return (
    <Collapsible defaultOpen className='space-y-4'>
      <CollapsibleTrigger asChild>
        <Button variant='ghost' className='flex w-full justify-between p-0 hover:bg-transparent'>
          <h3 className='text-sm font-medium'>Scheduling</h3>
          <CalendarIcon className='h-4 w-4' />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className='space-y-4'>
        {/* Publish At */}
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='publish-at'>Publish At</Label>
            {publishAt && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={clearPublishAt}
                disabled={disabled}
                className='h-6 px-2'
              >
                <X className='h-3 w-3' />
              </Button>
            )}
          </div>

          <div className='flex gap-2'>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant='outline'
                  disabled={disabled}
                  data-empty={!publishAt}
                  className={cn(
                    'flex-1 justify-start text-start font-normal',
                    !publishAt && 'text-muted-foreground'
                  )}
                >
                  {publishAt ? format(publishAt, 'MMM d, yyyy') : 'Pick a date'}
                  <CalendarIcon className='ms-auto h-4 w-4 opacity-50' />
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-auto p-0'>
                <Calendar
                  mode='single'
                  captionLayout='dropdown'
                  selected={publishAt || undefined}
                  onSelect={handlePublishDateSelect}
                  disabled={(date: Date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                />
              </PopoverContent>
            </Popover>

            <Input
              type='time'
              id='publish-at'
              value={publishAt ? format(publishAt, 'HH:mm') : ''}
              onChange={handlePublishTimeChange}
              disabled={disabled || !publishAt}
              className='w-32'
            />
          </div>
        </div>

        {/* Unpublish At */}
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='unpublish-at'>Unpublish At (Optional)</Label>
            {unpublishAt && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={clearUnpublishAt}
                disabled={disabled}
                className='h-6 px-2'
              >
                <X className='h-3 w-3' />
              </Button>
            )}
          </div>

          <div className='flex gap-2'>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant='outline'
                  disabled={disabled}
                  data-empty={!unpublishAt}
                  className={cn(
                    'flex-1 justify-start text-start font-normal',
                    !unpublishAt && 'text-muted-foreground'
                  )}
                >
                  {unpublishAt ? format(unpublishAt, 'MMM d, yyyy') : 'Pick a date'}
                  <CalendarIcon className='ms-auto h-4 w-4 opacity-50' />
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-auto p-0'>
                <Calendar
                  mode='single'
                  captionLayout='dropdown'
                  selected={unpublishAt || undefined}
                  onSelect={handleUnpublishDateSelect}
                  disabled={(date: Date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                />
              </PopoverContent>
            </Popover>

            <Input
              type='time'
              id='unpublish-at'
              value={unpublishAt ? format(unpublishAt, 'HH:mm') : ''}
              onChange={handleUnpublishTimeChange}
              disabled={disabled || !unpublishAt}
              className='w-32'
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
