import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { ErrorBanner } from '@/components/error-banner'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { buildTenantAdminUrl } from '@/lib/tenant-route'
import { setCurrentTenantSlug, useTenants } from '../api'

export function TenantList() {
  const { data: tenants, isLoading, error } = useTenants()

  const openTenantWorkspace = (tenantSlug: string) => {
    setCurrentTenantSlug(tenantSlug)
    window.location.assign(buildTenantAdminUrl(tenantSlug))
  }

  return (
    <>
      <AuthPageHeader />

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Tenants</h2>
            <p className='text-muted-foreground'>Manage tenant instances and user access.</p>
          </div>
          <Button asChild>
            <Link to='/admin/tenants/new'>
              <Plus className='mr-2 size-4' />
              Create Tenant
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
          <ErrorBanner message='Failed to load tenants. Please try again.' />
        )}

        {tenants && (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className='text-right'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className='text-center text-muted-foreground'>
                      No tenants found. Create your first tenant to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  tenants.map((tenant) => (
                    <TableRow key={tenant.id}>
                      <TableCell className='font-medium'>{tenant.name}</TableCell>
                      <TableCell>
                        <code className='rounded bg-muted px-2 py-1 text-xs'>{tenant.slug}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'}>
                          {tenant.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{tenant.userCount ?? 0}</TableCell>
                      <TableCell title={toBrowserDateTime(tenant.createdAt) ?? undefined}>
                        {toRelativeTime(tenant.createdAt)}
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='inline-flex items-center gap-1'>
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => openTenantWorkspace(tenant.slug)}
                          >
                            Open
                          </Button>
                          <Button variant='ghost' size='sm' asChild>
                            <Link
                              to='/admin/tenants/$tenantSlug'
                              params={{ tenantSlug: tenant.slug }}
                            >
                              Edit
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Main>
    </>
  )
}
