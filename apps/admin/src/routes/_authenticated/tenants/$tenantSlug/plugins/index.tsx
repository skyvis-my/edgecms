import { createFileRoute } from '@tanstack/react-router'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { PluginsPanel } from '@/features/plugins/plugins-panel'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/plugins/')({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: PluginsPage,
})

function PluginsPage() {
  return (
    <>
      <AuthPageHeader />
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <PluginsPanel />
      </Main>
    </>
  )
}
