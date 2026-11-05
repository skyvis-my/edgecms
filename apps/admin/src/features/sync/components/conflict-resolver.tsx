import { Check, GitMerge } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EntryStatusIndicator } from '@/features/entries/components/entry-status-indicator'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import {
  buildConflictReview,
  type ConflictChoices,
  type ConflictReview,
  conflictKey,
  countConflicts,
  type FieldConflict,
  type MergeSource,
  readServerEntry,
  resolveConflictReview,
  SLUG_CONFLICT_KEY,
} from '../field-merge'
import { type CommandQueueItem, db } from '../local-db'
import { getLocalizedFieldNames } from '../sync-engine'
import { triggerSync } from '../sync-scheduler'
import { useSyncStore } from '../sync-store'

type ConflictResolverProps = {
  conflict: CommandQueueItem
  open: boolean
  onClose: () => void
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'Empty'
  if (typeof value === 'string') return value === '' ? 'Empty' : value
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function conflictLabel(conflict: Pick<FieldConflict, 'field' | 'locale'>): string {
  if (conflict.field === SLUG_CONFLICT_KEY) return 'URL slug'
  return conflict.field
}

function describeOverwrites(keys: Array<{ field: string; locale?: string }>): string {
  return keys
    .map((k) => (k.locale ? `${conflictLabel(k)} (${k.locale.toUpperCase()})` : conflictLabel(k)))
    .join(', ')
}

/** Load the localized field names for the conflicted entry's collection (OF-04). */
function useLocalizedFields(collectionId: string | undefined): string[] | undefined {
  const [fields, setFields] = useState<string[] | undefined>(collectionId ? undefined : [])
  useEffect(() => {
    let cancelled = false
    if (!collectionId) {
      setFields([])
      return
    }
    void getLocalizedFieldNames(collectionId).then((names) => {
      if (!cancelled) setFields(names)
    })
    return () => {
      cancelled = true
    }
  }, [collectionId])
  return fields
}

function ChoiceTile({
  selected,
  side,
  title,
  value,
  onSelect,
  name,
}: {
  selected: boolean
  side: MergeSource
  title: string
  value: unknown
  onSelect: () => void
  name: string
}) {
  return (
    <label
      className={cn(
        'group relative flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-md border-2 p-3 text-start transition-colors',
        'focus-within:ring-ring/50 focus-within:ring-[3px]',
        selected
          ? side === 'local'
            ? 'border-violet-600 bg-violet-50 dark:border-violet-400 dark:bg-violet-950/40'
            : 'border-blue-600 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40'
          : 'border-border bg-background hover:border-foreground/30'
      )}
    >
      <input
        type='radio'
        name={name}
        value={side}
        checked={selected}
        onChange={onSelect}
        className='sr-only'
      />
      <span className='flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide'>
        <span>{title}</span>
        <span
          aria-hidden='true'
          className={cn(
            'flex size-5 items-center justify-center rounded-full border',
            selected
              ? side === 'local'
                ? 'border-violet-600 bg-violet-600 text-white dark:border-violet-400 dark:bg-violet-400 dark:text-violet-950'
                : 'border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-blue-950'
              : 'border-muted-foreground/40'
          )}
        >
          {selected && <Check className='size-3.5' />}
        </span>
      </span>
      <pre className='max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed'>
        {formatValue(value)}
      </pre>
    </label>
  )
}

function ConflictCard({
  conflict,
  choice,
  serverVersion,
  hasBase,
  onChoose,
}: {
  conflict: FieldConflict
  choice: MergeSource
  serverVersion: number
  hasBase: boolean
  onChoose: (source: MergeSource) => void
}) {
  const key = conflictKey(conflict)
  return (
    <fieldset
      data-testid='conflict-field'
      data-conflict-key={key}
      className='min-w-0 rounded-lg border bg-card p-3 sm:p-4'
    >
      <legend className='sr-only'>
        {conflictLabel(conflict)}
        {conflict.locale ? `, locale ${conflict.locale}` : ''}
      </legend>
      <div aria-hidden='true' className='mb-2 flex flex-wrap items-center gap-2'>
        <span className='font-mono text-sm font-semibold'>{conflictLabel(conflict)}</span>
        {conflict.locale && (
          <span className='rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase text-muted-foreground'>
            {conflict.locale}
          </span>
        )}
      </div>
      {hasBase && (
        <p className='mb-2 truncate text-xs text-muted-foreground'>
          Before both edits: <span className='font-mono'>{formatValue(conflict.base)}</span>
        </p>
      )}
      <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
        <ChoiceTile
          name={`conflict-${key}`}
          side='local'
          title='Keep mine'
          value={conflict.local}
          selected={choice === 'local'}
          onSelect={() => onChoose('local')}
        />
        <ChoiceTile
          name={`conflict-${key}`}
          side='remote'
          title={`Take theirs · v${serverVersion}`}
          value={conflict.remote}
          selected={choice === 'remote'}
          onSelect={() => onChoose('remote')}
        />
      </div>
    </fieldset>
  )
}

/**
 * OF-04 conflict review. Lists only the fields (and locales) both sides changed;
 * everything else is already merged. Unchosen conflicts take the server value, and
 * keeping your own value over a newer server value needs a second confirmation.
 */
export function ConflictResolver({ conflict, open, onClose }: ConflictResolverProps) {
  const [choices, setChoices] = useState<ConflictChoices>({})
  // Inline confirmation step (a nested modal would fight the dialog's focus trap).
  const [confirmStep, setConfirmStep] = useState<'overwrite' | 'discard' | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirmStep) confirmButtonRef.current?.focus()
  }, [confirmStep])
  const [resolving, setResolving] = useState(false)
  const syncStore = useSyncStore()

  const serverEntry = useMemo(() => readServerEntry(conflict.serverState), [conflict.serverState])
  const localizedFields = useLocalizedFields(serverEntry?.collectionId)
  const review: ConflictReview | undefined = useMemo(
    () =>
      localizedFields === undefined
        ? undefined
        : buildConflictReview({
            envelope: conflict.envelope,
            base: conflict.base,
            serverEntry,
            localizedFields,
          }),
    [conflict.envelope, conflict.base, serverEntry, localizedFields]
  )
  const loading = localizedFields === undefined

  const items: FieldConflict[] = review
    ? [...(review.slugConflict ? [review.slugConflict] : []), ...review.merge.conflicts]
    : []
  const choiceFor = (c: FieldConflict): MergeSource => choices[conflictKey(c)] ?? 'remote'
  const resolution = review ? resolveConflictReview(review, choices) : undefined
  const keptMine = resolution?.overwritesRemote ?? []

  const setAll = (source: MergeSource) => {
    const next: ConflictChoices = {}
    for (const c of items) next[conflictKey(c)] = source
    setChoices(next)
  }

  const finish = async (message: string, description: string) => {
    await syncStore.refreshCounts()
    toast.success(message, { description })
    onClose()
  }

  const apply = async () => {
    if (!review || !resolution || conflict.id === undefined) return
    setResolving(true)
    try {
      if (resolution.unchanged) {
        // The server already has the result: drop the queued change instead of pushing a no-op.
        await db.commandQueue.delete(conflict.id)
        await finish('Server version kept', 'Your queued change was removed; nothing needed syncing.')
        return
      }
      await db.commandQueue.update(conflict.id, {
        envelope: resolution.envelope,
        base: resolution.base,
        status: 'pending',
        error: undefined,
        serverState: undefined,
      })
      await triggerSync()
      await finish('Conflict resolved', `Merged change queued against server version ${review.serverEntry.version}.`)
    } catch (error) {
      logger.error('Failed to resolve conflict:', error)
      toast.error('Failed to resolve conflict', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setResolving(false)
      setConfirmStep(null)
    }
  }

  const handleSave = () => {
    if (keptMine.length > 0) {
      setConfirmStep('overwrite')
      return
    }
    void apply()
  }

  const discard = async () => {
    if (conflict.id === undefined) return
    setResolving(true)
    try {
      await db.commandQueue.delete(conflict.id)
      await finish('Queued change discarded', 'The server version stays as it is.')
    } catch (error) {
      logger.error('Failed to discard queued change:', error)
      toast.error('Failed to discard queued change')
    } finally {
      setResolving(false)
      setConfirmStep(null)
    }
  }

  const payload = (conflict.envelope.payload ?? {}) as Record<string, unknown>
  const entryLabel =
    (typeof payload.slug === 'string' && payload.slug) ||
    serverEntry?.slug ||
    (typeof payload.entryId === 'string' ? payload.entryId : 'Queued change')
  const autoMergedCount = review?.merge.autoMerged.length ?? 0
  const conflictTotal = review ? countConflicts(review) : 0

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !resolving && onClose()}>
      <DialogContent
        data-testid='conflict-resolver'
        className='flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-4 overflow-hidden p-4 sm:p-6'
      >
        <DialogHeader className='text-start'>
          <DialogTitle className='flex items-center gap-2'>
            <GitMerge aria-hidden='true' className='size-5 shrink-0' />
            Review sync conflict
          </DialogTitle>
          <DialogDescription asChild>
            <div className='space-y-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='max-w-full truncate font-mono text-sm text-foreground'>{entryLabel}</span>
                <EntryStatusIndicator
                  variant='header'
                  status={serverEntry?.status ?? 'draft'}
                  queue={{ pending: 0, conflicted: 1 }}
                />
              </div>
              {review ? (
                <p>
                  Your offline change was based on{' '}
                  {conflict.base ? `version ${conflict.base.version}` : 'an older version'}; the server
                  is now at version {review.serverEntry.version}.{' '}
                  {conflictTotal === 0
                    ? 'Nothing overlaps.'
                    : `${conflictTotal} ${conflictTotal === 1 ? 'change needs' : 'changes need'} your choice.`}
                  {autoMergedCount > 0 &&
                    ` ${autoMergedCount} other ${autoMergedCount === 1 ? 'change was' : 'changes were'} merged automatically.`}
                </p>
              ) : !loading ? (
                <p>
                  This queued change cannot be merged field by field
                  {conflict.error ? `: ${conflict.error}` : '.'}
                </p>
              ) : null}
              {review && !review.hasBase && (
                <p className='text-xs'>
                  No starting snapshot was saved with this change, so every field that differs from the
                  server is listed.
                </p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className='-mx-1 flex-1 space-y-3 overflow-y-auto px-1'>
          {loading && <p className='py-6 text-center text-sm text-muted-foreground'>Loading…</p>}
          {review &&
            items.map((c) => (
              <ConflictCard
                key={conflictKey(c)}
                conflict={c}
                choice={choiceFor(c)}
                serverVersion={review.serverEntry.version}
                hasBase={review.hasBase}
                onChoose={(source) => setChoices((prev) => ({ ...prev, [conflictKey(c)]: source }))}
              />
            ))}
        </div>

        {confirmStep && (
          <div
            role='alertdialog'
            aria-labelledby='conflict-confirm-title'
            aria-describedby='conflict-confirm-desc'
            data-testid='conflict-confirm'
            className='flex-shrink-0 space-y-3 rounded-lg border-2 border-red-600 bg-red-50 p-3 text-red-950 dark:border-red-400 dark:bg-red-950/40 dark:text-red-50'
          >
            <p id='conflict-confirm-title' className='font-semibold'>
              {confirmStep === 'overwrite'
                ? `Overwrite server version ${review?.serverEntry.version ?? ''}?`
                : 'Discard this queued change?'}
            </p>
            <p id='conflict-confirm-desc' className='text-sm'>
              {confirmStep === 'overwrite'
                ? `The server has newer values for ${describeOverwrites(keptMine)}. Your values will replace them when this change syncs.`
                : 'It will not be sent to the server. This cannot be undone.'}
            </p>
            <div className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
              <Button type='button' variant='outline' onClick={() => setConfirmStep(null)} disabled={resolving}>
                Cancel
              </Button>
              <Button
                ref={confirmButtonRef}
                type='button'
                variant='destructive'
                onClick={() => void (confirmStep === 'overwrite' ? apply() : discard())}
                disabled={resolving}
              >
                {confirmStep === 'overwrite' ? 'Overwrite and sync' : 'Discard'}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter
          className={cn(
            'flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
            confirmStep !== null && 'hidden sm:hidden'
          )}
        >
          {review && items.length > 1 ? (
            <div className='flex gap-2'>
              <Button type='button' variant='ghost' size='sm' onClick={() => setAll('local')} disabled={resolving}>
                Keep all mine
              </Button>
              <Button type='button' variant='ghost' size='sm' onClick={() => setAll('remote')} disabled={resolving}>
                Take all theirs
              </Button>
            </div>
          ) : (
            <span />
          )}
          <div className='flex flex-col-reverse gap-2 sm:flex-row'>
            <Button type='button' variant='outline' onClick={onClose} disabled={resolving}>
              Cancel
            </Button>
            {review ? (
              <Button type='button' onClick={handleSave} disabled={resolving || loading}>
                {resolving
                  ? 'Saving…'
                  : keptMine.length > 0
                    ? `Save, overwriting ${keptMine.length} server ${keptMine.length === 1 ? 'value' : 'values'}`
                    : 'Save merge'}
              </Button>
            ) : (
              !loading && (
                <Button
                  type='button'
                  variant='destructive'
                  onClick={() => setConfirmStep('discard')}
                  disabled={resolving}
                >
                  Discard queued change
                </Button>
              )
            )}
          </div>
        </DialogFooter>
      </DialogContent>

    </Dialog>
  )
}
