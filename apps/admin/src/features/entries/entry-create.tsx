import { Link, useParams } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCollectionByIdentifier } from '@/features/collections/api/collections-api'
import { EntryForm } from './components/entry-form'

export function EntryCreate() {
  const { tenantSlug, collectionId } = useParams({
    from: '/_authenticated/tenants/$tenantSlug/collections/$collectionId/entries/create',
  })

  const { data: collection, isLoading, error } = useCollectionByIdentifier(collectionId)
  const entriesPath = `/tenants/${tenantSlug}/collections/${collection?.slug ?? collectionId}/entries`

  return (
    <>
      <Header fixed>
        <Search />
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-2'>
            <Button variant='ghost' size='sm' asChild>
              <Link to={entriesPath}>
                <ChevronLeft className='size-4 mr-1' />
                Back to Entries
              </Link>
            </Button>
          </div>
          <h2 className='text-2xl font-bold tracking-tight'>
            Create Entry {collection ? `— ${collection.name}` : ''}
          </h2>
        </div>

        {isLoading && (
          <div className='space-y-4'>
            <Skeleton className='h-48 w-full' />
            <Skeleton className='h-64 w-full' />
          </div>
        )}

        {error && (
          <div className='rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive'>
            <p>Failed to load collection. Please try again.</p>
            <Button variant='outline' size='sm' className='mt-3' onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        )}

        {collection && <EntryForm collection={collection} mode='create' />}
      </Main>
    </>
  )
}
