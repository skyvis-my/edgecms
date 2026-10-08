import { createFileRoute } from '@tanstack/react-router'
import { EntryCreate } from '@/features/entries/entry-create'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

export const Route = createFileRoute(
  '/_authenticated/tenants/$tenantSlug/collections/$collectionId/entries/create'
)({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: EntryCreate,
})
