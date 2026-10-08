import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { DiffEntry } from '../use-execute-command'

type DiffPreviewProps = {
  diffs: DiffEntry[]
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

/**
 * Format a value for display in the diff preview
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
 * Get the badge variant for a diff action
 */
function getActionBadgeVariant(
  action: DiffEntry['action']
): 'default' | 'secondary' | 'destructive' {
  switch (action) {
    case 'add':
      return 'default' // Green
    case 'update':
      return 'secondary' // Blue
    case 'remove':
      return 'destructive' // Red
  }
}

/**
 * Diff preview component that shows field-level changes before saving
 *
 * This component is used in the "Preview Changes" flow where users can
 * see what will change before confirming a save operation.
 */
export function DiffPreview({ diffs, open, onClose, onConfirm }: DiffPreviewProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className='max-w-4xl max-h-[80vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Preview Changes</DialogTitle>
          <DialogDescription>
            Review the changes that will be applied to this entry before saving.
          </DialogDescription>
        </DialogHeader>

        <div className='py-4'>
          {diffs.length === 0 ? (
            <p className='text-muted-foreground text-center py-8'>No changes detected.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-[200px]'>Field</TableHead>
                  <TableHead className='w-[100px]'>Action</TableHead>
                  <TableHead>Before</TableHead>
                  <TableHead>After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diffs.map((diff, index) => (
                  <TableRow key={`${diff.field}-${index}`}>
                    <TableCell className='font-mono text-sm'>{diff.field}</TableCell>
                    <TableCell>
                      <Badge variant={getActionBadgeVariant(diff.action)}>
                        {diff.action.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {diff.action === 'add' ? (
                        <span className='text-muted-foreground'>—</span>
                      ) : (
                        <div className='bg-red-50 dark:bg-red-950/20 px-2 py-1 rounded text-sm line-through'>
                          {formatValue(diff.before)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {diff.action === 'remove' ? (
                        <span className='text-muted-foreground'>—</span>
                      ) : (
                        <div className='bg-green-50 dark:bg-green-950/20 px-2 py-1 rounded text-sm'>
                          {formatValue(diff.after)}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button type='button' variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button type='button' onClick={onConfirm} disabled={diffs.length === 0}>
            Confirm Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
