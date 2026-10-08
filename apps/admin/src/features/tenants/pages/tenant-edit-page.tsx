import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { ErrorBanner } from '@/components/error-banner'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTenant } from '../api'
import { TenantForm } from './tenant-form'

type TenantEditPageProps = {
  tenantSlug: string
}

export function TenantEditPage({ tenantSlug }: TenantEditPageProps) {
  const { data: tenant, isLoading, error } = useTenant(tenantSlug)

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
            <h2 className='text-2xl font-bold tracking-tight'>
              {tenant ? `Edit ${tenant.name}` : 'Edit Tenant'}
            </h2>
            <p className='text-muted-foreground'>Update tenant settings and manage users</p>
          </div>
        </div>

        {isLoading && (
          <div className='space-y-4'>
            <Skeleton className='h-64 w-full' />
          </div>
        )}

        {error && (
          <ErrorBanner message='Failed to load tenant. Please try again.' />
        )}

        {tenant && <TenantForm tenant={tenant} mode='edit' />}
      </Main>
    </>
  )
}
