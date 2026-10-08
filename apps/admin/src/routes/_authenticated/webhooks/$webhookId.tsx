import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { ErrorBanner } from '@/components/error-banner'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { FormSkeleton } from '@/components/form-skeleton'
import { Skeleton } from '@/components/ui/skeleton'
import { useWebhook } from '@/features/webhooks/api'
import { DeliveryLog } from '@/features/webhooks/delivery-log'
import { WebhookForm } from '@/features/webhooks/webhook-form'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

function WebhookEdit() {
  const { webhookId } = useParams({ strict: false }) as { webhookId: string }
  const { data: webhook, isLoading, error } = useWebhook(webhookId)

  return (
    <>
      <AuthPageHeader />

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-center gap-2'>
          <Button variant='ghost' size='icon' asChild>
            <Link to='/webhooks'>
              <ArrowLeft className='size-4' />
              <span className='sr-only'>Back to webhooks</span>
            </Link>
          </Button>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              {webhook ? 'Edit Webhook' : <Skeleton className='h-7 w-40' />}
            </h2>
            <p className='text-muted-foreground'>
              Update webhook configuration and view delivery logs
            </p>
          </div>
        </div>

        {isLoading && <FormSkeleton fields={5} />}

        {error && (
          <ErrorBanner message='Failed to load webhook. Please try again.' />
        )}

        {webhook && (
          <div className='space-y-6'>
            <WebhookForm mode='edit' webhook={webhook} />
            <DeliveryLog webhookId={webhook.id} />
          </div>
        )}
      </Main>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/webhooks/$webhookId')({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: WebhookEdit,
})
