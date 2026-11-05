import { createFileRoute } from '@tanstack/react-router'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { PluginContributionPage } from '@/features/plugins/admin-contributions/admin-contributions'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

// HS-10: pages contributed by trusted plugins through the build-time catalog.
export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/plugins/$pluginName/$pageId')({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: PluginPage,
})

function PluginPage() {
  const { tenantSlug, pluginName, pageId } = Route.useParams()
  return (
    <>
      <AuthPageHeader />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <PluginContributionPage tenantSlug={tenantSlug} pluginName={pluginName} pageId={pageId} />
      </Main>
    </>
  )
}
