import { createFileRoute } from '@tanstack/react-router'
import { Collections } from '@/features/collections'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/collections/')({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: Collections,
})
