import { Link, useParams } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { ErrorBanner } from '@/components/error-banner'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toRelativeTime } from '@/lib/date-time'
import { useCollections } from './api/collections-api'
import { CollectionsDeleteDialog } from './components/collections-delete-dialog'
import { CollectionsProvider } from './components/collections-provider'
import { CollectionsTable } from './components/collections-table'

export function Collections() {
  const { data: collections, isLoading, error } = useCollections()
  const { tenantSlug } = useParams({ strict: false }) as { tenantSlug?: string }

  const latestUpdatedAt = useMemo(() => {
    if (!collections || collections.length === 0) return null
    return collections.reduce((latest, collection) => {
      return new Date(collection.updatedAt) > new Date(latest.updatedAt) ? collection : latest
    }).updatedAt
  }, [collections])

  const createSingletonPath = tenantSlug
    ? `/tenants/${tenantSlug}/collections/create-singleton`
    : '/admin/tenants'
  const createCollectionPath = tenantSlug
    ? `/tenants/${tenantSlug}/collections/create`
    : '/admin/tenants'

  return (
    <>
      <AuthPageHeader />

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Content Manager</h2>
            <p className='text-sm text-muted-foreground'>
              {collections?.length ?? 0} collection types
              {latestUpdatedAt ? ` • Updated ${toRelativeTime(latestUpdatedAt)}` : ''}
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Button asChild variant='outline'>
              <Link to={createSingletonPath} aria-label='Create Singleton'>
                <Plus className='mr-2 size-4' />
                Singleton
              </Link>
            </Button>
            <Button asChild>
              <Link to={createCollectionPath} aria-label='Create Collection'>
                <Plus className='mr-2 size-4' />
                Collection
              </Link>
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className='space-y-4'>
            <Skeleton className='h-10 w-full sm:w-72' />
            <Skeleton className='h-72 w-full' />
          </div>
        )}

        {error && (
          <ErrorBanner message='Failed to load collections. Please try again.' />
        )}

        {collections && (
          <CollectionsProvider>
            <CollectionsTable data={collections} />
            <CollectionsDeleteDialog />
          </CollectionsProvider>
        )}
      </Main>
    </>
  )
}
