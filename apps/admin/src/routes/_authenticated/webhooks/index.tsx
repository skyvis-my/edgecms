import { createFileRoute } from '@tanstack/react-router'
import { WebhookList } from '@/features/webhooks/webhook-list'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

export const Route = createFileRoute('/_authenticated/webhooks/')({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: WebhookList,
})
