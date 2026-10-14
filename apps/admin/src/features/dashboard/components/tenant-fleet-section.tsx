import type { ComponentType } from 'react'
import { HardDrive, Users } from 'lucide-react'
import { ErrorBanner } from '@/components/error-banner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes } from '@/features/assets/media-utils'
import type { Tenant } from '@/features/tenants/api'

export interface TenantFleetSectionProps {
  tenants: Tenant[] | undefined
  topTenants?: Tenant[]
  tenantsLoading: boolean
  tenantsError?: unknown
  totalTenantUsers: number
  totalMediaBytes: number
  totalMediaAssets: number
  assetUsageLoading: boolean
  assetUsageByTenantId: Map<string, { totalBytes: number; assetCount: number }>
  openTenantWorkspace: (tenantSlug: string) => void
  TenantCardSkeleton: ComponentType
}

export function TenantFleetSection({
  tenants,
  topTenants = [],
  tenantsLoading,
  tenantsError,
  totalTenantUsers,
  totalMediaBytes,
  totalMediaAssets,
  assetUsageLoading,
  assetUsageByTenantId,
  openTenantWorkspace,
  TenantCardSkeleton,
}: TenantFleetSectionProps) {
  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]'>
      <Card>
        <CardHeader className='flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <CardTitle className='text-base'>Tenant Workspaces</CardTitle>
            <p className='text-sm text-muted-foreground'>
              Workspace access with user count, media usage, and operational status.
            </p>
          </div>
          <Badge variant='outline'>
            {assetUsageLoading
              ? `${totalTenantUsers} users`
              : `${formatBytes(totalMediaBytes)} / ${totalMediaAssets} assets`}
          </Badge>
        </CardHeader>
        <CardContent>
          {Boolean(tenantsError) && (
            <ErrorBanner message='Failed to load tenants. Please try again.' />
          )}

          {tenantsLoading && (
            <div className='grid gap-4 md:grid-cols-2'>
              <TenantCardSkeleton />
              <TenantCardSkeleton />
            </div>
          )}

          {tenants && tenants.length === 0 && (
            <div className='rounded-md border py-8 text-center'>
              <p className='text-muted-foreground'>
                No tenants found. Create first tenant to start operating EdgeCMS.
              </p>
            </div>
          )}

          {tenants && tenants.length > 0 && (
            <div className='grid gap-4 md:grid-cols-2'>
              {tenants.map((tenant) => {
                const usage = assetUsageByTenantId.get(tenant.id)
                const mediaBytesLabel = assetUsageLoading
                  ? 'Loading media usage'
                  : `${formatBytes(usage?.totalBytes ?? 0)} / ${usage?.assetCount ?? 0} assets`
                return (
                  <Card key={tenant.id} className='bg-muted/20'>
                    <CardHeader className='flex flex-row items-start justify-between pb-3'>
                      <div className='space-y-1'>
                        <CardTitle className='text-base'>{tenant.name}</CardTitle>
                        <code className='rounded bg-muted px-2 py-0.5 text-xs'>{tenant.slug}</code>
                      </div>
                      <Badge variant={tenant.status === 'active' ? 'default' : 'secondary'}>
                        {tenant.status}
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      <div className='flex items-center justify-between gap-3'>
                        <div className='space-y-1 text-sm text-muted-foreground'>
                          <div className='flex items-center gap-1'>
                            <Users className='h-3.5 w-3.5' />
                            <span>{tenant.userCount ?? 0} users</span>
                          </div>
                          <div className='flex items-center gap-1'>
                            <HardDrive className='h-3.5 w-3.5' />
                            <span>{mediaBytesLabel}</span>
                          </div>
                          <div>Locale catalog: {tenant.localeCatalog.length}</div>
                          <div>
                            Upload cap: {formatBytes(tenant.mediaUploadMaxBytes)}, resize{' '}
                            {tenant.mediaUploadMaxDimension}px
                          </div>
                        </div>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => openTenantWorkspace(tenant.slug)}
                        >
                          Open
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>Most Active Tenants</CardTitle>
          <p className='text-sm text-muted-foreground'>
            Top workspaces by assigned admin users.
          </p>
        </CardHeader>
        <CardContent className='space-y-3'>
          {tenantsLoading ? (
            <>
              <Skeleton className='h-12 w-full' />
              <Skeleton className='h-12 w-full' />
              <Skeleton className='h-12 w-full' />
            </>
          ) : topTenants && topTenants.length > 0 ? (
            topTenants.map((tenant, index) => (
              <div key={tenant.id} className='flex items-center justify-between rounded-md border p-3'>
                <div className='flex items-center gap-3'>
                  <div className='flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-medium'>
                    {index + 1}
                  </div>
                  <div>
                    <div className='text-sm font-medium'>{tenant.name}</div>
                    <div className='text-xs text-muted-foreground'>{tenant.slug}</div>
                  </div>
                </div>
                <Badge variant='outline'>{tenant.userCount ?? 0} users</Badge>
              </div>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>No tenant activity yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
