import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { TenantForm } from '@/features/tenants/pages/tenant-form'

export const Route = createFileRoute('/_authenticated/admin/tenants/new')({
  component: TenantCreate,
})

function TenantCreate() {
  return (
    <>
      <AuthPageHeader />

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-center gap-2'>
          <Button variant='ghost' size='icon' asChild>
            <Link to='/admin/tenants'>
              <ArrowLeft className='size-4' />
              <span className='sr-only'>Back to tenants</span>
            </Link>
          </Button>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Create Tenant</h2>
            <p className='text-muted-foreground'>Create a new tenant instance</p>
          </div>
        </div>

        <TenantForm mode='create' />
      </Main>
    </>
  )
}
