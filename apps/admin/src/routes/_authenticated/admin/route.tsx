import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { hasGlobalAdminAccess } from '@/lib/admin-role'

export const Route = createFileRoute('/_authenticated/admin')({
  beforeLoad: ({ context }) => {
    const ctx = context as { user?: { role?: string } }
    if (!hasGlobalAdminAccess(ctx.user?.role)) {
      throw redirect({ to: '/403' })
    }
  },
  component: () => <Outlet />,
})
