import { createFileRoute } from '@tanstack/react-router'
import { Settings } from '@/features/settings'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/settings')({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: Settings,
})
