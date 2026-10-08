import { createFileRoute } from '@tanstack/react-router'
import { TenantList } from '@/features/tenants/pages/tenant-list'

export const Route = createFileRoute('/_authenticated/admin/tenants/')({
  component: TenantList,
})
