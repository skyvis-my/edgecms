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
import { useEntryByIdentifier } from './api/entries-api'
import { EntryForm } from './components/entry-form'

export function EntryEdit() {
  const { tenantSlug, collectionId, entryId } = useParams({
    from: '/_authenticated/tenants/$tenantSlug/collections/$collectionId/entries/$entryId/',
  })

  const {
    data: collection,
    isLoading: isLoadingCollection,
    error: collectionError,
  } = useCollectionByIdentifier(collectionId)
  const {
    data: entry,
    isLoading: isLoadingEntry,
    error: entryError,
  } = useEntryByIdentifier(entryId, {
    collectionId: collection?.id,
    enabled: Boolean(collection?.id),
    preferCollectionLookup: true,
  })

  const isLoading = isLoadingCollection || isLoadingEntry
  const error = collectionError || entryError
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
        <div className='space-y-2'>
          <Button variant='ghost' size='sm' asChild className='-ml-2 w-fit'>
            <Link to={entriesPath}>
              <ChevronLeft className='mr-1 size-4' />
              Back to Entries
            </Link>
          </Button>
          <h2 className='text-2xl font-semibold tracking-tight'>
            Edit Entry {collection ? `— ${collection.name}` : ''}
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
            <p>Failed to load data. Please try again.</p>
            <Button variant='outline' size='sm' className='mt-3' onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        )}

        {collection && entry && <EntryForm collection={collection} entry={entry} mode='edit' />}
      </Main>
    </>
  )
}
