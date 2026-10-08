import { createFileRoute } from '@tanstack/react-router'
import { EntryEdit } from '@/features/entries/entry-edit'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

export const Route = createFileRoute(
  '/_authenticated/tenants/$tenantSlug/collections/$collectionId/entries/$entryId/'
)({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: EntryEdit,
})
