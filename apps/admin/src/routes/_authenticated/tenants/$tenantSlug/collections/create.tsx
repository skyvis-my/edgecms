import { createFileRoute } from '@tanstack/react-router'
import { CollectionCreate } from '@/features/collections/collection-create'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/collections/create')({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: () => <CollectionCreate kind='collection' />,
})
