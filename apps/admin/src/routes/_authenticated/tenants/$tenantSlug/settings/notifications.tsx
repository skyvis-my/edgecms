import { createFileRoute } from '@tanstack/react-router'
import { SettingsNotifications } from '@/features/settings/notifications'

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/settings/notifications')({
  component: SettingsNotifications,
})
