import { useQueryClient } from '@tanstack/react-query'
import { Calendar, Clock, Send, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
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
import {
  buildCancelScheduleCommand,
  buildPublishNowCommand,
  buildUnpublishNowCommand,
} from '@/features/commands/command-builder'
import { useExecuteCommand } from '@/features/commands/use-execute-command'
import { type Entry, useEntries } from '@/features/entries/api/entries-api'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { StatusBadge } from '../components/status-badge'

type ScheduledItem = {
  id: string
  entry: Entry
  type: 'publish' | 'unpublish'
  scheduledDate: string
}

/**
 * PublishingOverview page displays a list of scheduled entries
 * with actions to publish now, unpublish now, or cancel schedule
 */
export function PublishingOverview() {
  const [selectedCollection, setSelectedCollection] = useState<string>('all')
  const [selectedType, setSelectedType] = useState<'all' | 'publish' | 'unpublish'>('all')
  const [pendingAction, setPendingAction] = useState<
    | { type: 'publish'; entryId: string }
    | { type: 'unpublish'; entryId: string }
    | { type: 'cancel'; entryId: string }
    | null
  >(null)
  const executeCommand = useExecuteCommand()
  const queryClient = useQueryClient()

  // Fetch collections for filter
  const { data: collectionsResponse, isLoading: isLoadingCollections } = useCollections()

  // Fetch scheduled entries (scheduled to publish)
  const {
    data: scheduledEntriesResponse,
    isLoading: isLoadingScheduled,
  } = useEntries({
    status: 'scheduled',
    collectionId: selectedCollection === 'all' ? undefined : selectedCollection,
    perPage: 100,
  })

  // Fetch published entries (to discover scheduled unpublishes)
  const {
    data: publishedEntriesResponse,
    isLoading: isLoadingPublished,
  } = useEntries({
    status: 'published',
    collectionId: selectedCollection === 'all' ? undefined : selectedCollection,
    perPage: 100,
  })

  const isLoading = isLoadingCollections || isLoadingScheduled || isLoadingPublished
  const collections = collectionsResponse || []

  // Combine scheduled publishes and scheduled unpublishes
  const scheduledItems = useMemo<ScheduledItem[]>(() => {
    const items: ScheduledItem[] = []

    const scheduledEntries = scheduledEntriesResponse?.data || []
    for (const entry of scheduledEntries) {
      const scheduledDate =
        entry.publishAt || (entry.data.publishAt as string) || entry.updatedAt
      items.push({
        id: `${entry.id}-publish`,
        entry,
        type: 'publish',
        scheduledDate,
      })
    }

    const publishedEntries = publishedEntriesResponse?.data || []
    for (const entry of publishedEntries) {
      if (entry.unpublishAt) {
        items.push({
          id: `${entry.id}-unpublish`,
          entry,
          type: 'unpublish',
          scheduledDate: entry.unpublishAt,
        })
      }
    }

    // Sort by scheduledDate ascending (soonest first)
    items.sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime())

    if (selectedType === 'all') return items
    return items.filter((item) => item.type === selectedType)
  }, [scheduledEntriesResponse?.data, publishedEntriesResponse?.data, selectedType])

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

  const handleUnpublishNow = async (entryId: string) => {
    try {
      const command = buildUnpublishNowCommand(entryId)
      await executeCommand.mutateAsync(command)
      toast.success('Entry unpublished successfully')
      queryClient.invalidateQueries({ queryKey: ['entries'] })
    } catch (error) {
      logger.error('Unpublish error:', error)
      toast.error('Failed to unpublish entry')
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

          <div className='flex flex-wrap gap-2'>
            <Select
              value={selectedType}
              onValueChange={(val) => setSelectedType(val as 'all' | 'publish' | 'unpublish')}
            >
              <SelectTrigger className='w-[160px]'>
                <SelectValue placeholder='All actions' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All Actions</SelectItem>
                <SelectItem value='publish'>Publish Only</SelectItem>
                <SelectItem value='unpublish'>Unpublish Only</SelectItem>
              </SelectContent>
            </Select>

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

        {!isLoading && scheduledItems.length === 0 && (
          <Card>
            <CardContent className='flex flex-col items-center justify-center p-12 text-center'>
              <Calendar className='mb-4 h-12 w-12 text-muted-foreground' />
              <p className='mb-2 text-lg font-medium'>No scheduled transitions</p>
              <p className='text-muted-foreground'>
                Entries scheduled for publication or unpublication will appear here
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && scheduledItems.length > 0 && (
          <Card>
            <CardContent className='p-0'>
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entry</TableHead>
                      <TableHead>Collection</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Scheduled Date</TableHead>
                      <TableHead className='text-right'>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scheduledItems.map(({ id, entry, type, scheduledDate }) => {
                      const titleField = entry.data.title || entry.data.name || entry.slug

                      return (
                        <TableRow key={id}>
                          <TableCell className='font-medium'>
                            {typeof titleField === 'string'
                              ? titleField
                              : typeof titleField === 'object' && titleField !== null
                                ? String(Object.values(titleField)[0] || entry.slug)
                                : entry.slug}
                          </TableCell>
                          <TableCell>{getCollectionName(entry.collectionId)}</TableCell>
                          <TableCell>
                            {type === 'publish' ? (
                              <Badge variant='outline' className='border-blue-500 text-blue-600 gap-1'>
                                <Clock className='size-3' />
                                Publish
                              </Badge>
                            ) : (
                              <Badge variant='outline' className='border-amber-500 text-amber-600 gap-1'>
                                <Trash2 className='size-3' />
                                Unpublish
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              status={entry.status}
                              scheduledDate={type === 'publish' ? scheduledDate : undefined}
                              unpublishDate={type === 'unpublish' ? scheduledDate : undefined}
                            />
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
                              {type === 'publish' ? (
                                <Button
                                  size='sm'
                                  variant='outline'
                                  onClick={() =>
                                    setPendingAction({ type: 'publish', entryId: entry.id })
                                  }
                                  disabled={executeCommand.isPending}
                                >
                                  <Send className='mr-1 h-3 w-3' />
                                  Publish Now
                                </Button>
                              ) : (
                                <Button
                                  size='sm'
                                  variant='outline'
                                  onClick={() =>
                                    setPendingAction({ type: 'unpublish', entryId: entry.id })
                                  }
                                  disabled={executeCommand.isPending}
                                >
                                  <Trash2 className='mr-1 h-3 w-3' />
                                  Unpublish Now
                                </Button>
                              )}
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
        title={
          pendingAction?.type === 'publish'
            ? 'Publish now?'
            : pendingAction?.type === 'unpublish'
              ? 'Unpublish now?'
              : 'Cancel schedule?'
        }
        desc={
          pendingAction?.type === 'publish'
            ? 'This will publish the entry immediately.'
            : pendingAction?.type === 'unpublish'
              ? 'This will unpublish the entry immediately and move it back to draft.'
              : 'This will cancel the scheduled transition.'
        }
        confirmText={
          pendingAction?.type === 'publish'
            ? 'Publish Now'
            : pendingAction?.type === 'unpublish'
              ? 'Unpublish Now'
              : 'Cancel Schedule'
        }
        handleConfirm={async () => {
          if (!pendingAction) return
          if (pendingAction.type === 'publish') {
            await handlePublishNow(pendingAction.entryId)
          } else if (pendingAction.type === 'unpublish') {
            await handleUnpublishNow(pendingAction.entryId)
          } else {
            await handleCancelSchedule(pendingAction.entryId)
          }
          setPendingAction(null)
        }}
      />
    </>
  )
}
