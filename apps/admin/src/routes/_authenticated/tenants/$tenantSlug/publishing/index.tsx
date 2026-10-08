import { createFileRoute } from '@tanstack/react-router'
import { PublishingOverview } from '@/features/scheduling/pages/overview'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/publishing/')({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: PublishingOverviewPage,
})

function PublishingOverviewPage() {
  return <PublishingOverview />
}
