import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { ErrorBanner } from '@/components/error-banner'
import { AuthPageHeader } from '@/components/layout/auth-page-header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCollection } from './api/collections-api'
import { CollectionForm } from './components/collection-form'

export function CollectionEdit() {
  const { tenantSlug, collectionId } = useParams({ strict: false }) as {
    tenantSlug?: string
    collectionId: string
  }
  const backPath = tenantSlug ? `/tenants/${tenantSlug}/collections` : '/admin/tenants'
  const { data: collection, isLoading, error } = useCollection(collectionId)

  return (
    <>
      <AuthPageHeader />

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-center gap-2'>
          <Button variant='ghost' size='icon' asChild>
            <Link to={backPath}>
              <ArrowLeft className='size-4' />
              <span className='sr-only'>Back to collections</span>
            </Link>
          </Button>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              {collection ? `Edit ${collection.name}` : 'Edit Collection'}
            </h2>
            <p className='text-muted-foreground'>Update your collection definition and fields</p>
          </div>
        </div>

        {isLoading && (
          <div className='space-y-4'>
            <Skeleton className='h-48 w-full' />
            <Skeleton className='h-64 w-full' />
          </div>
        )}

        {error && (
          <ErrorBanner message='Failed to load collection. Please try again.' />
        )}

        {collection && <CollectionForm mode='edit' collection={collection} />}
      </Main>
    </>
  )
}
