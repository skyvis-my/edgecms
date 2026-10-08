import { Clock, RotateCcw, User } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { toBrowserDateTime, toRelativeTime } from '@/lib/date-time'
import { useVersions } from '../api'
import { RollbackDialog } from './rollback-dialog'

type VersionHistoryProps = {
  entryId: string
  currentVersion: number
  isOpen: boolean
  onToggle: () => void
  onDiffRequest?: (v1: string, v2: string) => void
}

export function VersionHistory({
  entryId,
  currentVersion,
  isOpen,
  onToggle,
  onDiffRequest,
}: VersionHistoryProps) {
  const [page, setPage] = useState(1)
  const [selectedV1, setSelectedV1] = useState<string | null>(null)
  const [selectedV2, setSelectedV2] = useState<string | null>(null)
  const [rollbackVersion, setRollbackVersion] = useState<{
    id: string
    version: number
    timestamp: string
  } | null>(null)

  const { data, isLoading, error } = useVersions(entryId, page)

  const handleCompare = () => {
    if (selectedV1 && selectedV2 && onDiffRequest) {
      onDiffRequest(selectedV1, selectedV2)
    }
  }

  const handleLoadMore = () => {
    setPage((prev) => prev + 1)
  }

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={onToggle}>
        <div className='flex items-center justify-between p-4 border-b'>
          <div className='flex items-center gap-2'>
            <Clock className='size-4 text-muted-foreground' />
            <h3 className='font-semibold'>Version History</h3>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant='ghost' size='sm'>
              {isOpen ? 'Hide' : 'Show'}
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className='p-4 space-y-4'>
            {isLoading && page === 1 && (
              <div className='space-y-3'>
                <Skeleton className='h-20 w-full' />
                <Skeleton className='h-20 w-full' />
                <Skeleton className='h-20 w-full' />
              </div>
            )}

            {error && (
              <div className='text-sm text-red-600 p-3 bg-red-50 rounded-md'>
                Failed to load version history. Please try again.
              </div>
            )}

            {data && (
              <>
                <div className='space-y-2'>
                  <div className='flex items-center justify-between text-sm text-muted-foreground'>
                    <span>Select two versions to compare</span>
                    {selectedV1 && selectedV2 && (
                      <Button size='sm' variant='secondary' onClick={handleCompare}>
                        Compare
                      </Button>
                    )}
                  </div>

                  <RadioGroup
                    value={selectedV2 || ''}
                    onValueChange={(value) => {
                      if (!selectedV1) {
                        setSelectedV1(value)
                      } else if (selectedV1 === value) {
                        setSelectedV1(null)
                      } else {
                        setSelectedV2(value)
                      }
                    }}
                  >
                    <ScrollArea className='h-[400px]'>
                      <div className='space-y-3'>
                        {data.data.map((version) => (
                          <div
                            key={version.id}
                            className={`p-3 border rounded-md hover:bg-accent transition-colors ${
                              selectedV1 === version.id || selectedV2 === version.id
                                ? 'ring-2 ring-primary'
                                : ''
                            }`}
                          >
                            <div className='flex items-start justify-between gap-2'>
                              <div className='flex items-center gap-2'>
                                <RadioGroupItem value={version.id} id={version.id} />
                                <label
                                  htmlFor={version.id}
                                  className='flex-1 cursor-pointer space-y-1'
                                >
                                  <div className='flex items-center gap-2'>
                                    <span className='font-semibold text-sm'>
                                      Version {version.version}
                                    </span>
                                    {version.version === currentVersion && (
                                      <Badge variant='default' className='text-xs'>
                                        Current
                                      </Badge>
                                    )}
                                  </div>
                                  <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                                    <Clock className='size-3' />
                                    <span title={toBrowserDateTime(version.createdAt) ?? undefined}>
                                      {toRelativeTime(version.createdAt)}
                                    </span>
                                  </div>
                                  {version.createdBy && (
                                    <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                                      <User className='size-3' />
                                      <span>{version.createdBy}</span>
                                    </div>
                                  )}
                                  {version.changeSummary && (
                                    <p className='text-xs text-muted-foreground mt-1'>
                                      {version.changeSummary}
                                    </p>
                                  )}
                                </label>
                              </div>

                              {version.version !== currentVersion && (
                                <Button
                                  size='sm'
                                  variant='ghost'
                                  onClick={() =>
                                    setRollbackVersion({
                                      id: version.id,
                                      version: version.version,
                                      timestamp: version.createdAt,
                                    })
                                  }
                                  className='shrink-0'
                                >
                                  <RotateCcw className='size-3 mr-1' />
                                  Rollback
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </RadioGroup>
                </div>

                {data.meta.pagination.hasMore && (
                  <>
                    <Separator />
                    <Button
                      variant='outline'
                      className='w-full'
                      onClick={handleLoadMore}
                      disabled={isLoading}
                    >
                      {isLoading ? 'Loading...' : 'Load More'}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <RollbackDialog
        entryId={entryId}
        version={rollbackVersion}
        onClose={() => setRollbackVersion(null)}
      />
    </>
  )
}
