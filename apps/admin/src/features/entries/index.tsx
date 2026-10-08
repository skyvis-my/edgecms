import { getRouteApi, Link, useParams } from '@tanstack/react-router'
import { ChevronLeft, MoreHorizontal, Plus, Settings2 } from 'lucide-react'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useCollectionByIdentifier } from '@/features/collections/api/collections-api'
import { useEntries } from './api/entries-api'
import { EntriesDeleteDialog } from './components/entries-delete-dialog'
import { EntriesProvider } from './components/entries-provider'
import { EntriesTable } from './components/entries-table'

const route = getRouteApi('/_authenticated/tenants/$tenantSlug/collections/$collectionId/entries/')

function EntriesWorkspace() {
  const { tenantSlug, collectionId } = useParams({
    from: '/_authenticated/tenants/$tenantSlug/collections/$collectionId/entries/',
  })
  const search = route.useSearch()
  const navigate = route.useNavigate()

  const collectionsPath = `/tenants/${tenantSlug}/collections`
  const selectedStatus = Array.isArray(search.status) ? search.status[0] : undefined

  const {
    data: collection,
    isLoading: isLoadingCollection,
    error: collectionError,
  } = useCollectionByIdentifier(collectionId)

  const {
    data: entriesResponse,
    isLoading: isLoadingEntries,
    error: entriesError,
  } = useEntries({
    collectionId,
    collectionSlug: collectionId,
    status: selectedStatus,
    page: search.page,
    perPage: search.pageSize,
  })

  const isLoading = isLoadingCollection || isLoadingEntries
  const error = collectionError || entriesError
  const entries = Array.isArray(entriesResponse?.data) ? entriesResponse.data : []
  const totalRows = entriesResponse?.meta?.pagination?.total ?? entries.length

  const createEntryPath = collection
    ? `/tenants/${tenantSlug}/collections/${collection.slug}/entries/create`
    : '/admin/tenants'
  const editSchemaPath = collection
    ? `/tenants/${tenantSlug}/collections/${collection.id}`
    : '/admin/tenants'

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
        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div className='space-y-2'>
            <Button variant='ghost' size='sm' asChild className='-ml-2 w-fit'>
              <Link to={collectionsPath}>
                <ChevronLeft className='mr-1 size-4' />
                Back to Content Manager
              </Link>
            </Button>
            <div>
              <h2 className='text-2xl font-bold tracking-tight'>{collection?.name ?? 'Entries'}</h2>
              <p className='text-sm text-muted-foreground'>{totalRows} entries found</p>
            </div>
          </div>

          {collection && (
            <div className='flex items-center gap-2'>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='outline' size='icon'>
                    <MoreHorizontal className='size-4' />
                    <span className='sr-only'>Open collection actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem asChild>
                    <Link to={editSchemaPath}>
                      <Settings2 className='mr-2 size-4' />
                      Edit schema
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button asChild>
                <Link to={createEntryPath}>
                  <Plus className='mr-2 size-4' />
                  Create new entry
                </Link>
              </Button>
            </div>
          )}
        </div>

        {isLoading && (
          <div className='space-y-4'>
            <Skeleton className='h-10 w-full sm:w-72' />
            <Skeleton className='h-72 w-full' />
          </div>
        )}

        {error && (
          <div className='rounded-md border border-destructive/40 bg-destructive/10 p-4 text-destructive'>
            Failed to load data. Please try again.
          </div>
        )}

        {collection && !isLoading && !error && (
          <EntriesTable
            data={entries}
            collection={collection}
            totalRows={totalRows}
            search={search as Record<string, unknown>}
            navigate={navigate}
          />
        )}
      </Main>
    </>
  )
}

export function Entries() {
  return (
    <EntriesProvider>
      <EntriesWorkspace />
      <EntriesDeleteDialog />
    </EntriesProvider>
  )
}
