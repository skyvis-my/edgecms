import type { EntryStatus } from '@/features/entries/api/entries-api'
import { EntryStatusIndicator } from '@/features/entries/components/entry-status-indicator'

type StatusBadgeProps = {
  status: EntryStatus
  scheduledDate?: string | null
  unpublishDate?: string | null
  className?: string
}

/**
 * Scheduling overview badge. Delegates to the shared EntryStatusIndicator (OF-05)
 * so lifecycle labels, icons, colours and scheduled times match the entry list and editor.
 */
export function StatusBadge({ status, scheduledDate, unpublishDate, className }: StatusBadgeProps) {
  return (
    <EntryStatusIndicator
      status={status}
      publishAt={scheduledDate}
      unpublishAt={unpublishDate}
      className={className}
    />
  )
}
