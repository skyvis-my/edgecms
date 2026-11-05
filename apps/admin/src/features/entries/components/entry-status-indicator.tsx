import {
  Archive,
  CalendarClock,
  CalendarX,
  Check,
  CircleCheck,
  CircleDot,
  CloudUpload,
  Loader2,
  PencilLine,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { toBrowserDateTime } from '@/lib/date-time'
import { cn } from '@/lib/utils'
import {
  type EntryStatusDescriptor,
  type EntryStatusInput,
  getEntryStatusDescriptor,
  type LifecycleDescriptor,
  type StatusTone,
  type SyncDescriptor,
} from '../lib/entry-status'

// No yellow/amber/orange (OF-05). Tone never stands alone: every chip has an icon and a text label.
const TONE_CLASSES: Record<StatusTone, string> = {
  neutral:
    'border-slate-400 bg-slate-50 text-slate-700 dark:border-slate-500 dark:bg-slate-900/40 dark:text-slate-200',
  info: 'border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-200',
  success:
    'border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-400 dark:bg-emerald-950/40 dark:text-emerald-200',
  muted:
    'border-dashed border-zinc-400 bg-transparent text-zinc-600 dark:border-zinc-500 dark:text-zinc-300',
  accent:
    'border-violet-500 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200',
  danger: 'border-red-600 bg-red-50 text-red-800 dark:border-red-400 dark:bg-red-950/40 dark:text-red-200',
}

const LIFECYCLE_ICONS: Record<LifecycleDescriptor['icon'], LucideIcon> = {
  draft: PencilLine,
  published: CircleCheck,
  scheduled: CalendarClock,
  archived: Archive,
}

const SYNC_ICONS: Record<SyncDescriptor['icon'], LucideIcon> = {
  saved: Check,
  unsaved: CircleDot,
  saving: Loader2,
  queued: CloudUpload,
  conflicted: TriangleAlert,
}

function Chip({
  tone,
  icon: Icon,
  label,
  spin,
  testId,
}: {
  tone: StatusTone
  icon: LucideIcon
  label: string
  spin?: boolean
  testId: string
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[tone]
      )}
    >
      <Icon aria-hidden='true' className={cn('size-3.5 shrink-0', spin && 'animate-spin')} />
      {label}
    </span>
  )
}

type EntryStatusIndicatorProps = EntryStatusInput & {
  /** 'row' stacks compactly for table cells; 'header' lays out inline and wraps on narrow screens. */
  variant?: 'row' | 'header'
  className?: string
}

/**
 * Single status indicator for entry list rows and the editor header (OF-05).
 * Shows lifecycle, the scheduled time when relevant, and local sync state
 * (unsaved / queued offline / conflict) from the command queue.
 */
export function EntryStatusIndicator({
  variant = 'row',
  className,
  ...input
}: EntryStatusIndicatorProps) {
  const descriptor: EntryStatusDescriptor = getEntryStatusDescriptor({
    formatDate: (iso) => toBrowserDateTime(iso) ?? iso,
    ...input,
  })
  const { lifecycle, schedule, sync } = descriptor
  const ScheduleIcon = schedule?.kind === 'unpublish' ? CalendarX : CalendarClock

  return (
    <div
      role='group'
      aria-label={descriptor.accessibleName}
      data-testid='entry-status-indicator'
      data-lifecycle={lifecycle.key}
      data-sync={sync?.key ?? 'none'}
      className={cn(
        'flex min-w-0',
        variant === 'header' ? 'flex-wrap items-center gap-x-2 gap-y-1' : 'flex-col items-start gap-1',
        className
      )}
    >
      <Chip
        testId='entry-status-lifecycle'
        tone={lifecycle.tone}
        icon={LIFECYCLE_ICONS[lifecycle.icon]}
        label={lifecycle.label}
      />
      {schedule && (
        <span
          data-testid='entry-status-schedule'
          className='inline-flex items-center gap-1 text-xs text-muted-foreground'
        >
          <ScheduleIcon aria-hidden='true' className='size-3.5 shrink-0' />
          <time dateTime={schedule.at}>{schedule.label}</time>
        </span>
      )}
      {sync && (
        <Chip
          testId='entry-status-sync'
          tone={sync.tone}
          icon={SYNC_ICONS[sync.icon]}
          spin={sync.key === 'saving'}
          label={sync.count && sync.count > 1 ? `${sync.label} (${sync.count})` : sync.label}
        />
      )}
    </div>
  )
}
