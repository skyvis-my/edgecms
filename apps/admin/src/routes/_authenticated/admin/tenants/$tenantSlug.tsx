import { createFileRoute } from '@tanstack/react-router'
import { TenantEditPage } from '@/features/tenants/pages/tenant-edit-page'

export const Route = createFileRoute('/_authenticated/admin/tenants/$tenantSlug')({
  component: TenantEdit,
})

function TenantEdit() {
  const { tenantSlug } = Route.useParams()
  return <TenantEditPage tenantSlug={tenantSlug} />
}
