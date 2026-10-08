import { createFileRoute, redirect } from '@tanstack/react-router'
import { setCurrentTenantSlug } from '@/features/tenants/api'

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug')({
  beforeLoad: ({ params, location }) => {
    setCurrentTenantSlug(params.tenantSlug)
    const canonicalTenantRoot = `/tenants/${params.tenantSlug}`
    const normalizedPath = location.pathname?.replace(/\/+$/, '') || canonicalTenantRoot

    if (normalizedPath !== canonicalTenantRoot) {
      return
    }

    throw redirect({
      to: '/tenants/$tenantSlug/collections',
      params: { tenantSlug: params.tenantSlug },
    })
  },
})
