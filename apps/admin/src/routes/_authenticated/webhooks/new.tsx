import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { WebhookForm } from '@/features/webhooks/webhook-form'
import { requireActiveTenantSlug } from '@/lib/tenant-route'

function WebhookNew() {
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
            <h2 className='text-2xl font-bold tracking-tight'>Create Webhook</h2>
            <p className='text-muted-foreground'>Configure a new webhook endpoint</p>
          </div>
        </div>

        <WebhookForm mode='create' />
      </Main>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/webhooks/new')({
  beforeLoad: ({ location }) => {
    requireActiveTenantSlug(location.href)
  },
  component: WebhookNew,
})
