import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { type CommandQueueItem, db } from '../local-db'
import { queueCommand } from '../queue-command'
import { triggerSync } from '../sync-scheduler'
import { useSyncStore } from '../sync-store'

type ConflictResolverProps = {
  conflict: CommandQueueItem
  open: boolean
  onClose: () => void
}

type FieldChoice = 'local' | 'server'

/**
 * Conflict Resolver Component
 *
 * Shows side-by-side comparison of local vs server changes
 * Allows per-field merge or bulk "keep all" actions
 */
export function ConflictResolver({ conflict, open, onClose }: ConflictResolverProps) {
  const [fieldChoices, setFieldChoices] = useState<Record<string, FieldChoice>>({})
  const [resolving, setResolving] = useState(false)
  const syncStore = useSyncStore()

  const envelope = conflict.envelope as {
    type?: string
    payload?: { data?: Record<string, unknown> }
  }
  const localData = envelope.payload?.data || {}
  const serverEntry = (conflict.serverState as { entry?: { data?: Record<string, unknown> } })
    ?.entry
  const serverState = serverEntry?.data || {}

  // Get all unique field keys from both local and server
  const allFields = Array.from(
    new Set([...Object.keys(localData), ...Object.keys(serverState)])
  ).sort()

  const handleFieldChoice = (field: string, choice: FieldChoice) => {
    setFieldChoices((prev) => ({ ...prev, [field]: choice }))
  }

  const handleKeepAllLocal = () => {
    const choices: Record<string, FieldChoice> = {}
    for (const field of allFields) {
      choices[field] = 'local'
    }
    setFieldChoices(choices)
  }

  const handleKeepAllServer = () => {
    const choices: Record<string, FieldChoice> = {}
    for (const field of allFields) {
      choices[field] = 'server'
    }
    setFieldChoices(choices)
  }

  const handleApplyMerge = async () => {
    setResolving(true)

    try {
      // Build merged data based on field choices
      const mergedData: Record<string, unknown> = {}

      for (const field of allFields) {
        const choice = fieldChoices[field] || 'local' // Default to local if no choice
        if (choice === 'local') {
          if (field in localData) {
            mergedData[field] = localData[field]
          }
        } else {
          if (field in serverState) {
            mergedData[field] = serverState[field]
          }
        }
      }

      // Build a new command envelope with merged data
      const mergedEnvelope = {
        ...envelope,
        payload: {
          ...envelope.payload,
          data: mergedData,
        },
      }

      // Queue the merged command as pending
      await queueCommand(mergedEnvelope as never)

      // Delete the conflicted item
      if (conflict.id !== undefined) {
        await db.commandQueue.delete(conflict.id)
      }

      // Refresh counts
      await syncStore.refreshCounts()

      // Trigger sync
      await triggerSync()

      toast.success('Conflict resolved', {
        description: 'Your merged changes have been queued for sync.',
      })

      onClose()
    } catch (error) {
      logger.error('Failed to resolve conflict:', error)
      toast.error('Failed to resolve conflict', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setResolving(false)
    }
  }

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '—'
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2)
    }
    return String(value)
  }

  const fieldsWithDifferences = allFields.filter((field) => {
    return JSON.stringify(localData[field]) !== JSON.stringify(serverState[field])
  })

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className='max-w-5xl max-h-[90vh] overflow-hidden flex flex-col'>
        <DialogHeader>
          <DialogTitle>Resolve Sync Conflict</DialogTitle>
          <DialogDescription>
            Choose which version to keep for each field, or select all local/server changes at once.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue='diff' className='flex-1 overflow-hidden flex flex-col'>
          <TabsList>
            <TabsTrigger value='diff'>Differences ({fieldsWithDifferences.length})</TabsTrigger>
            <TabsTrigger value='all'>All Fields ({allFields.length})</TabsTrigger>
          </TabsList>

          <TabsContent value='diff' className='flex-1 overflow-y-auto'>
            {fieldsWithDifferences.length === 0 ? (
              <p className='text-muted-foreground text-center py-8'>No differences detected.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-[200px]'>Field</TableHead>
                    <TableHead>Local Value</TableHead>
                    <TableHead>Server Value</TableHead>
                    <TableHead className='w-[150px]'>Choice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fieldsWithDifferences.map((field) => (
                    <TableRow key={field}>
                      <TableCell className='font-mono text-sm font-semibold align-top'>
                        {field}
                      </TableCell>
                      <TableCell className='align-top'>
                        {field in localData ? (
                          <div className='bg-blue-50 dark:bg-blue-950/20 px-2 py-1 rounded text-sm'>
                            <pre className='whitespace-pre-wrap text-xs'>
                              {formatValue(localData[field])}
                            </pre>
                          </div>
                        ) : (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </TableCell>
                      <TableCell className='align-top'>
                        {field in serverState ? (
                          <div className='bg-green-50 dark:bg-green-950/20 px-2 py-1 rounded text-sm'>
                            <pre className='whitespace-pre-wrap text-xs'>
                              {formatValue(serverState[field])}
                            </pre>
                          </div>
                        ) : (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </TableCell>
                      <TableCell className='align-top'>
                        <RadioGroup
                          value={fieldChoices[field] || 'local'}
                          onValueChange={(value) => handleFieldChoice(field, value as FieldChoice)}
                        >
                          <div className='flex items-center space-x-2'>
                            <RadioGroupItem value='local' id={`${field}-local`} />
                            <Label htmlFor={`${field}-local`} className='text-xs'>
                              Local
                            </Label>
                          </div>
                          <div className='flex items-center space-x-2'>
                            <RadioGroupItem value='server' id={`${field}-server`} />
                            <Label htmlFor={`${field}-server`} className='text-xs'>
                              Server
                            </Label>
                          </div>
                        </RadioGroup>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value='all' className='flex-1 overflow-y-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-[200px]'>Field</TableHead>
                  <TableHead>Local Value</TableHead>
                  <TableHead>Server Value</TableHead>
                  <TableHead className='w-[150px]'>Choice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allFields.map((field) => {
                  const isDifferent =
                    JSON.stringify(localData[field]) !== JSON.stringify(serverState[field])
                  return (
                    <TableRow key={field}>
                      <TableCell className='font-mono text-sm font-semibold align-top'>
                        {field}
                        {isDifferent && (
                          <Badge variant='destructive' className='ml-2 text-xs'>
                            diff
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className='align-top'>
                        {field in localData ? (
                          <div
                            className={`px-2 py-1 rounded text-sm ${
                              isDifferent
                                ? 'bg-blue-50 dark:bg-blue-950/20'
                                : 'bg-muted dark:bg-muted/50'
                            }`}
                          >
                            <pre className='whitespace-pre-wrap text-xs'>
                              {formatValue(localData[field])}
                            </pre>
                          </div>
                        ) : (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </TableCell>
                      <TableCell className='align-top'>
                        {field in serverState ? (
                          <div
                            className={`px-2 py-1 rounded text-sm ${
                              isDifferent
                                ? 'bg-green-50 dark:bg-green-950/20'
                                : 'bg-muted dark:bg-muted/50'
                            }`}
                          >
                            <pre className='whitespace-pre-wrap text-xs'>
                              {formatValue(serverState[field])}
                            </pre>
                          </div>
                        ) : (
                          <span className='text-muted-foreground'>—</span>
                        )}
                      </TableCell>
                      <TableCell className='align-top'>
                        <RadioGroup
                          value={fieldChoices[field] || 'local'}
                          onValueChange={(value) => handleFieldChoice(field, value as FieldChoice)}
                        >
                          <div className='flex items-center space-x-2'>
                            <RadioGroupItem value='local' id={`${field}-local-all`} />
                            <Label htmlFor={`${field}-local-all`} className='text-xs'>
                              Local
                            </Label>
                          </div>
                          <div className='flex items-center space-x-2'>
                            <RadioGroupItem value='server' id={`${field}-server-all`} />
                            <Label htmlFor={`${field}-server-all`} className='text-xs'>
                              Server
                            </Label>
                          </div>
                        </RadioGroup>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>

        <DialogFooter className='flex-shrink-0 gap-2'>
          <Button type='button' variant='outline' onClick={onClose} disabled={resolving}>
            Cancel
          </Button>
          <Button
            type='button'
            variant='secondary'
            onClick={handleKeepAllLocal}
            disabled={resolving}
          >
            Keep All Local
          </Button>
          <Button
            type='button'
            variant='secondary'
            onClick={handleKeepAllServer}
            disabled={resolving}
          >
            Keep All Server
          </Button>
          <Button type='button' onClick={handleApplyMerge} disabled={resolving}>
            {resolving ? 'Resolving...' : 'Apply Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
