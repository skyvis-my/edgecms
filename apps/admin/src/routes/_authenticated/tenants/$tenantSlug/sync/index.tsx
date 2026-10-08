import { createFileRoute } from '@tanstack/react-router'
import { Conflicts } from '@/features/sync/pages/conflicts'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/sync/')({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: Conflicts,
})
