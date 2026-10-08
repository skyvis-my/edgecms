import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { getSessionIfNeeded } from '@/lib/auth-client'

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

    return {
      user: session.user,
      session: session.session,
    }
  },
  component: AuthenticatedLayout,
})
