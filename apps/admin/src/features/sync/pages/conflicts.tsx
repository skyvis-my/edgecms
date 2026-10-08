import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Header } from '@/components/layout/header'
import { HeaderActions } from '@/components/layout/header-actions'
import { Main } from '@/components/layout/main'
import { Search } from '@/components/search'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { logger } from '@/lib/logger'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { ConflictResolver } from '../components/conflict-resolver'
import { type CommandQueueItem, db } from '../local-db'
import { triggerSync } from '../sync-scheduler'
import { useSyncStore } from '../sync-store'

/**
 * Conflicts page showing all conflicted commands
 *
 * Users can:
 * - See all conflicts in a list/table
 * - Click to resolve individual conflicts
 * - Trigger manual sync
 */
export function Conflicts() {
  const [selectedConflict, setSelectedConflict] = useState<CommandQueueItem | null>(null)
  const { status } = useSyncStore()
  const isSyncing = status === 'syncing'

  // Use Dexie live query to reactively track conflicts
  const conflicts = useLiveQuery(
    () => db.commandQueue.where('status').equals('conflicted').toArray(),
    []
  )

  const handleManualSync = async () => {
    try {
      await triggerSync()
    } catch (error) {
      logger.error('Manual sync failed:', error)
    }
  }

  const handleResolve = (conflict: CommandQueueItem) => {
    setSelectedConflict(conflict)
  }

  const getCommandLabel = (conflict: CommandQueueItem): string => {
    const envelope = conflict.envelope as { type?: string; payload?: Record<string, unknown> }
    const type = envelope.type || 'unknown'

    // Try to extract meaningful info from payload
    const payload = envelope.payload || {}
    const slug = payload.slug as string | undefined
    const entryId = payload.entryId as string | undefined
    const collectionId = payload.collectionId as string | undefined

    if (slug) return slug
    if (entryId) return entryId
    if (collectionId) return collectionId
    return type
  }

  return (
    <>
      <Header fixed>
        <Search />
        <HeaderActions />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Sync Conflicts</h2>
            <p className='text-muted-foreground'>
              Resolve conflicts between local changes and server state.
            </p>
          </div>
          <Button onClick={handleManualSync} disabled={isSyncing}>
            <RefreshCw className={`mr-2 size-4 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing...' : 'Manual Sync'}
          </Button>
        </div>

        {conflicts === undefined && (
          <div className='space-y-4'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-64 w-full' />
          </div>
        )}

        {conflicts && conflicts.length === 0 && (
          <div className='flex flex-col items-center justify-center py-16 text-center'>
            <CheckCircle className='size-16 text-green-500 mb-4' />
            <h3 className='text-xl font-semibold mb-2'>No Conflicts</h3>
            <p className='text-muted-foreground'>Everything is in sync.</p>
          </div>
        )}

        {conflicts && conflicts.length > 0 && (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-[150px]'>Command Type</TableHead>
                  <TableHead>Entity Info</TableHead>
                  <TableHead className='w-[200px]'>Timestamp</TableHead>
                  <TableHead className='w-[150px]'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conflicts.map((conflict) => {
                  const envelope = conflict.envelope as { type?: string }
                  return (
                    <TableRow key={conflict.id}>
                      <TableCell>
                        <Badge variant='secondary'>{envelope.type || 'unknown'}</Badge>
                      </TableCell>
                      <TableCell className='font-mono text-sm'>
                        {getCommandLabel(conflict)}
                      </TableCell>
                      <TableCell
                        className='text-muted-foreground text-sm'
                        title={toBrowserDateTime(conflict.createdAt) ?? undefined}
                      >
                        {toRelativeTime(conflict.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Button variant='outline' size='sm' onClick={() => handleResolve(conflict)}>
                          Resolve
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Main>

      {selectedConflict && (
        <ConflictResolver
          conflict={selectedConflict}
          open={selectedConflict !== null}
          onClose={() => setSelectedConflict(null)}
        />
      )}
    </>
  )
}
