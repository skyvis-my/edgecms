import { format, formatDistanceToNowStrict } from 'date-fns'

type DateInput = string | number | Date

export function toBrowserDateTime(value: DateInput): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return format(date, 'yyyy-MM-dd HH:mm:ss')
}

export function toRelativeTime(value: DateInput): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return formatDistanceToNowStrict(date, { addSuffix: true })
}
