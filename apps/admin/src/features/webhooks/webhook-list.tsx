import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { ErrorBanner } from '@/components/error-banner'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrentTenantSlug } from '@/features/tenants/api'
import { useWebhooks } from './api'
import { WebhooksTable } from './webhooks-table'

export function WebhookList() {
  const { data: webhooks, isLoading, error } = useWebhooks()
  const { data: tenantSlug } = useCurrentTenantSlug()
  const createWebhookPath = tenantSlug ? `/tenants/${tenantSlug}/webhooks/new` : '/webhooks/new'

  return (
    <>
      <AuthPageHeader />

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Webhooks</h2>
            <p className='text-muted-foreground'>
              Manage webhook endpoints and event subscriptions.
            </p>
          </div>
          <Button asChild>
            <Link to={createWebhookPath}>
              <Plus className='mr-2 size-4' />
              Create Webhook
            </Link>
          </Button>
        </div>

        {isLoading && (
          <div className='space-y-4'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-64 w-full' />
          </div>
        )}

        {error && (
          <ErrorBanner message='Failed to load webhooks. Please try again.' />
        )}

        {webhooks && <WebhooksTable data={webhooks} />}
      </Main>
    </>
  )
}
