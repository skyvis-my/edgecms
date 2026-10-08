import { createFileRoute, redirect } from '@tanstack/react-router'
import { setCurrentTenantSlug } from '@/features/tenants/api'

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/$')({
  beforeLoad: ({ params }) => {
    setCurrentTenantSlug(params.tenantSlug)
    const splat = (params as { _splat?: string })._splat
    const targetPath = splat ? `/${splat}` : '/collections'
    const maskedPath = splat
      ? `/tenants/${params.tenantSlug}/${splat}`
      : `/tenants/${params.tenantSlug}/collections`
    throw redirect({
      to: targetPath,
      mask: {
        to: maskedPath,
      },
    })
  },
})
