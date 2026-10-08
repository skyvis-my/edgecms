import { createFileRoute } from '@tanstack/react-router'
import { Conflicts } from '@/features/sync/pages/conflicts'

export const Route = createFileRoute('/_authenticated/sync/')({
  component: Conflicts,
})
