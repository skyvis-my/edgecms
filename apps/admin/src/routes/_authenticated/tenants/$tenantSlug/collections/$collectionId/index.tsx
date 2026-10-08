import { createFileRoute } from '@tanstack/react-router'
import { CollectionEdit } from '@/features/collections/collection-edit'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

export const Route = createFileRoute(
  '/_authenticated/tenants/$tenantSlug/collections/$collectionId/'
)({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: CollectionEdit,
})
