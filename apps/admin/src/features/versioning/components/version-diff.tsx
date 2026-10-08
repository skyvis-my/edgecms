import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { VersionDiff as VersionDiffType } from '../api'

type VersionDiffProps = {
  diffs: VersionDiffType[]
  olderVersion: number
  newerVersion: number
  onRollback?: () => void
  rollbackDisabled?: boolean
}

/**
 * Format a value for display in the diff view
 * - null/undefined shown as "—"
 * - Objects/arrays shown as JSON
 * - Strings/numbers/booleans shown as is
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—'
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }

  return String(value)
}

/**
 * Get the badge variant and background color for a diff action
 */
function getActionStyles(action: VersionDiffType['action']): {
  variant: 'default' | 'secondary' | 'destructive'
  bgClass: string
} {
  switch (action) {
    case 'add':
      return { variant: 'default', bgClass: 'bg-green-50 dark:bg-green-950/20' }
    case 'update':
      return { variant: 'secondary', bgClass: 'bg-yellow-50 dark:bg-yellow-950/20' }
    case 'remove':
      return { variant: 'destructive', bgClass: 'bg-red-50 dark:bg-red-950/20' }
  }
}

/**
 * Version diff component that shows field-level changes between two versions
 */
export function VersionDiff({
  diffs,
  olderVersion,
  newerVersion,
  onRollback,
  rollbackDisabled,
}: VersionDiffProps) {
  if (diffs.length === 0) {
    return (
      <div className='text-center py-8 text-muted-foreground'>
        No changes detected between these versions.
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between gap-2 text-sm font-medium'>
        <div className='flex items-center gap-2'>
          <span>Version {olderVersion}</span>
          <ArrowRight className='size-4 text-muted-foreground' />
          <span>Version {newerVersion}</span>
        </div>
        {onRollback && (
          <Button type='button' size='sm' variant='outline' onClick={onRollback} disabled={rollbackDisabled}>
            Rollback
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='w-[200px]'>Field</TableHead>
            <TableHead className='w-[100px]'>Action</TableHead>
            <TableHead>Before (v{olderVersion})</TableHead>
            <TableHead>After (v{newerVersion})</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {diffs.map((diff, index) => {
            const { variant, bgClass } = getActionStyles(diff.action)

            return (
              <TableRow key={`${diff.field}-${index}`}>
                <TableCell className='font-mono text-sm'>{diff.field}</TableCell>
                <TableCell>
                  <Badge variant={variant}>{diff.action.toUpperCase()}</Badge>
                </TableCell>
                <TableCell>
                  {diff.action === 'add' ? (
                    <span className='text-muted-foreground'>—</span>
                  ) : (
                    <div
                      className={`${
                        diff.action === 'remove'
                          ? 'bg-red-50 dark:bg-red-950/20 line-through'
                          : 'bg-yellow-50 dark:bg-yellow-950/20'
                      } px-3 py-2 rounded text-sm font-mono whitespace-pre-wrap break-all`}
                    >
                      {formatValue(diff.before)}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {diff.action === 'remove' ? (
                    <span className='text-muted-foreground'>—</span>
                  ) : (
                    <div
                      className={`${bgClass} px-3 py-2 rounded text-sm font-mono whitespace-pre-wrap break-all`}
                    >
                      {formatValue(diff.after)}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
