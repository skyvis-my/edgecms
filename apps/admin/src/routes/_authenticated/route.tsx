import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { getSessionIfNeeded } from '@/lib/auth-client'
import { ensureAccessToken } from '@/lib/access-token'
import { getCurrentTenantSlug } from '@/lib/tenant-storage'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const { data: session } = await getSessionIfNeeded()

    if (!session) {
      throw redirect({
        to: '/sign-in',
        search: {
          redirect: location.href,
        },
      })
    }

    // Prefetch the stateless RBAC token so admin API calls skip D1 reads.
    // Best-effort: failures fall back to cookie-session requests.
    try {
      await ensureAccessToken(getCurrentTenantSlug())
    } catch {
      // Ignore prefetch failures
    }

    return {
      user: session.user,
      session: session.session,
    }
  },
  component: AuthenticatedLayout,
})
