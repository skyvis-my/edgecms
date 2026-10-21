import { createFileRoute } from '@tanstack/react-router'
import { SettingsAi } from '@/features/settings/ai'

export const Route = createFileRoute('/_authenticated/tenants/$tenantSlug/settings/ai')({
  component: SettingsAi,
})
