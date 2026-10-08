import { useQueryClient } from '@tanstack/react-query'
import { Calendar, Send, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { logger } from '@/lib/logger'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCollections } from '@/features/collections/api/collections-api'
import { buildCancelScheduleCommand, buildPublishNowCommand } from '@/features/commands/command-builder'
import { useExecuteCommand } from '@/features/commands/use-execute-command'
import { useEntries } from '@/features/entries/api/entries-api'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { StatusBadge } from '../components/status-badge'

/**
 * PublishingOverview page displays a list of scheduled entries
 * with actions to publish now or cancel schedule
 */
export function PublishingOverview() {
  const [selectedCollection, setSelectedCollection] = useState<string>('all')
  const [pendingAction, setPendingAction] = useState<
    | { type: 'publish'; entryId: string }
    | { type: 'cancel'; entryId: string }
    | null
  >(null)
  const executeCommand = useExecuteCommand()
  const queryClient = useQueryClient()

  // Fetch collections for filter
  const { data: collectionsResponse, isLoading: isLoadingCollections } = useCollections()

  // Fetch scheduled entries
  const {
    data: entriesResponse,
    isLoading: isLoadingEntries,
  } = useEntries({
    status: 'scheduled',
    collectionId: selectedCollection === 'all' ? undefined : selectedCollection,
    perPage: 100,
  })

  const isLoading = isLoadingCollections || isLoadingEntries
  const scheduledEntries = entriesResponse?.data || []
  const collections = collectionsResponse || []

  const handlePublishNow = async (entryId: string) => {
    try {
      const command = buildPublishNowCommand(entryId)
      await executeCommand.mutateAsync(command)
      toast.success('Entry published successfully')
      queryClient.invalidateQueries({ queryKey: ['entries'] })
    } catch (error) {
      logger.error('Publish error:', error)
      toast.error('Failed to publish entry')
    }
  }

  const handleCancelSchedule = async (entryId: string) => {
    try {
      const command = buildCancelScheduleCommand(entryId)
      await executeCommand.mutateAsync(command)
      toast.success('Schedule cancelled successfully')
      queryClient.invalidateQueries({ queryKey: ['entries'] })
    } catch (error) {
      logger.error('Cancel schedule error:', error)
      toast.error('Failed to cancel schedule')
    }
  }

  // Get collection name by ID
  const getCollectionName = (collectionId: string) => {
    const collection = collections.find((c) => c.id === collectionId)
    return collection?.name || 'Unknown Collection'
  }

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
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Publishing Schedule</h2>
            <p className='text-muted-foreground'>
              Manage upcoming scheduled publications and unpublications
            </p>
          </div>

          <div className='flex gap-2'>
            <Select value={selectedCollection} onValueChange={setSelectedCollection}>
              <SelectTrigger className='w-[200px]'>
                <SelectValue placeholder='Filter by collection' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All Collections</SelectItem>
                {collections.map((collection) => (
                  <SelectItem key={collection.id} value={collection.id}>
                    {collection.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading && (
          <Card>
            <CardContent className='p-6'>
              <Skeleton className='h-64 w-full' />
            </CardContent>
          </Card>
        )}

        {!isLoading && scheduledEntries.length === 0 && (
          <Card>
            <CardContent className='flex flex-col items-center justify-center p-12 text-center'>
              <Calendar className='mb-4 h-12 w-12 text-muted-foreground' />
              <p className='mb-2 text-lg font-medium'>No scheduled entries</p>
              <p className='text-muted-foreground'>
                Entries scheduled for publication will appear here
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && scheduledEntries.length > 0 && (
          <Card>
            <CardContent className='p-0'>
              <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entry</TableHead>
                    <TableHead>Collection</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scheduled Date</TableHead>
                    <TableHead className='text-right'>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scheduledEntries.map((entry) => {
                    // Extract scheduled date from entry data
                    const scheduledDate = (entry.data.publishAt as string) || entry.updatedAt
                    const titleField = entry.data.title || entry.data.name || entry.slug

                    return (
                      <TableRow key={entry.id}>
                        <TableCell className='font-medium'>
                          {typeof titleField === 'string'
                            ? titleField
                            : typeof titleField === 'object' && titleField !== null
                              ? String(Object.values(titleField)[0] || entry.slug)
                              : entry.slug}
                        </TableCell>
                        <TableCell>{getCollectionName(entry.collectionId)}</TableCell>
                        <TableCell>
                          <StatusBadge status={entry.status} scheduledDate={scheduledDate} />
                        </TableCell>
                        <TableCell>
                          {scheduledDate ? (
                            <span title={toBrowserDateTime(scheduledDate) ?? undefined}>
                              {toRelativeTime(scheduledDate)}
                            </span>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell className='text-right'>
                          <div className='flex justify-end gap-2'>
                            <Button
                              size='sm'
                              variant='outline'
                              onClick={() => setPendingAction({ type: 'publish', entryId: entry.id })}
                              disabled={executeCommand.isPending}
                            >
                              <Send className='mr-1 h-3 w-3' />
                              Publish Now
                            </Button>
                            <Button
                              size='sm'
                              variant='ghost'
                              onClick={() =>
                                setPendingAction({
                                  type: 'cancel',
                                  entryId: entry.id,
                                })
                              }
                              disabled={executeCommand.isPending}
                            >
                              <X className='mr-1 h-3 w-3' />
                              Cancel
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </Main>
      <ConfirmDialog
        open={!!pendingAction}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
        title={pendingAction?.type === 'publish' ? 'Publish now?' : 'Cancel schedule?'}
        desc={
          pendingAction?.type === 'publish'
            ? 'This will publish the entry immediately.'
            : 'This will cancel the scheduled publication.'
        }
        confirmText={pendingAction?.type === 'publish' ? 'Publish Now' : 'Cancel Schedule'}
        handleConfirm={async () => {
          if (!pendingAction) return
          if (pendingAction.type === 'publish') {
            await handlePublishNow(pendingAction.entryId)
          } else {
            await handleCancelSchedule(pendingAction.entryId)
          }
          setPendingAction(null)
        }}
      />
    </>
  )
}
