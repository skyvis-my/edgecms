import { useId, useState, type ChangeEvent } from 'react'
import { AlertTriangle, Download, FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ApiClientError } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import {
  parseImportFile,
  useCollectionTransferAccess,
  useExecuteCollectionImport,
  useExportCollection,
  usePreviewCollectionImport,
  type EntryPlanAction,
  type ImportExecution,
  type ImportOutcome,
  type ImportPreview,
  type ImportStrategy,
  type RelationPlanAction,
} from '../api/collection-transfer-api'

const ACTION_LABEL: Record<EntryPlanAction, string> = {
  create: 'Create',
  update: 'Update',
  skip: 'Skip',
  conflict: 'Conflict',
  invalid: 'Invalid',
}

const ACTION_CLASS: Record<EntryPlanAction | RelationPlanAction, string> = {
  create: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300',
  update: 'border-sky-600/40 bg-sky-600/10 text-sky-800 dark:text-sky-300',
  link: 'border-sky-600/40 bg-sky-600/10 text-sky-800 dark:text-sky-300',
  skip: 'border-border bg-muted text-muted-foreground',
  conflict: 'border-violet-600/40 bg-violet-600/10 text-violet-800 dark:text-violet-300',
  invalid: 'border-destructive/50 bg-destructive/10 text-destructive',
}

const OUTCOME_LABEL: Record<ImportOutcome, string> = {
  success: 'Done',
  failed: 'Failed',
  not_run: 'Not run',
}

const OUTCOME_CLASS: Record<ImportOutcome, string> = {
  success: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300',
  failed: 'border-destructive/50 bg-destructive/10 text-destructive',
  not_run: 'border-border bg-muted text-muted-foreground',
}

/** Problems first, so a long plan shows what needs attention at the top. */
const ACTION_ORDER: Record<EntryPlanAction, number> = { invalid: 0, conflict: 1, update: 2, create: 3, skip: 4 }
const OUTCOME_ORDER: Record<ImportOutcome | 'none', number> = { failed: 0, not_run: 1, success: 2, none: 3 }

function sortBy<T>(items: readonly T[], rank: (item: T) => number): T[] {
  return items
    .map((item, position) => ({ item, position }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.position - b.position)
    .map(({ item }) => item)
}

function errorText(error: unknown): string {
  if (error instanceof ApiClientError) return error.code ? `${error.message} (${error.code})` : error.message
  if (error instanceof Error) return error.message
  return 'The request failed.'
}

function isPlanChanged(error: unknown) {
  return error instanceof ApiClientError && error.code === 'IMPORT_PLAN_CHANGED'
}

function formatTime(iso: string | undefined) {
  if (!iso) return undefined
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

type CollectionTransferActionsProps = {
  tenantSlug: string
  collectionSlug: string
  collectionName: string
}

/**
 * OP-06 admin screen: export a collection to JSON and import a file through
 * preview, explicit confirmation and per-entry results. Hidden for roles that
 * cannot use the routes; the API still checks every call.
 */
export function CollectionTransferActions({
  tenantSlug,
  collectionSlug,
  collectionName,
}: CollectionTransferActionsProps) {
  const { canExport, canImport } = useCollectionTransferAccess(tenantSlug)
  const exportMutation = useExportCollection()
  const [importOpen, setImportOpen] = useState(false)

  if (!canExport && !canImport) return null

  const handleExport = () => {
    exportMutation.mutate(collectionSlug, {
      onSuccess: (document_) =>
        toast.success(`Exported ${document_.entries.length} entries from ${collectionName}`),
      onError: (error) => toast.error(`Export failed: ${errorText(error)}`),
    })
  }

  return (
    <>
      {canExport && (
        <Button variant='outline' onClick={handleExport} disabled={exportMutation.isPending}>
          {exportMutation.isPending ? (
            <Loader2 className='mr-2 size-4 animate-spin' aria-hidden='true' />
          ) : (
            <Download className='mr-2 size-4' aria-hidden='true' />
          )}
          Export
        </Button>
      )}
      {canImport && (
        <Button variant='outline' onClick={() => setImportOpen(true)}>
          <FileUp className='mr-2 size-4' aria-hidden='true' />
          Import
        </Button>
      )}
      {canImport && (
        <CollectionImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          collectionSlug={collectionSlug}
          collectionName={collectionName}
        />
      )}
    </>
  )
}

type CollectionImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  collectionSlug: string
  collectionName: string
}

type Step = 'choose' | 'preview' | 'result'

export function CollectionImportDialog({
  open,
  onOpenChange,
  collectionSlug,
  collectionName,
}: CollectionImportDialogProps) {
  const fileInputId = useId()
  const [step, setStep] = useState<Step>('choose')
  const [fileName, setFileName] = useState<string | null>(null)
  const [document_, setDocument] = useState<unknown>(undefined)
  const [fileError, setFileError] = useState<string | null>(null)
  const [strategy, setStrategy] = useState<ImportStrategy>('skip')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportExecution | null>(null)
  const previewMutation = usePreviewCollectionImport(collectionSlug)
  const executeMutation = useExecuteCollectionImport(collectionSlug)

  const reset = () => {
    setStep('choose')
    setFileName(null)
    setDocument(undefined)
    setFileError(null)
    setStrategy('skip')
    setPreview(null)
    setResult(null)
    previewMutation.reset()
    executeMutation.reset()
  }

  const handleOpenChange = (next: boolean) => {
    // Do not close while the import runs: the result is the only record of it.
    if (!next && executeMutation.isPending) return
    if (!next) reset()
    onOpenChange(next)
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setDocument(undefined)
    setFileError(null)
    previewMutation.reset()
    setFileName(file?.name ?? null)
    if (!file) return
    const parsed = await parseImportFile(file)
    if (parsed.ok) setDocument(parsed.document)
    else setFileError(parsed.message)
  }

  const runPreview = () => {
    if (document_ === undefined) return
    executeMutation.reset()
    previewMutation.mutate(
      { document: document_, strategy },
      {
        onSuccess: (data) => {
          setPreview(data)
          setStep('preview')
        },
      }
    )
  }

  const runExecute = () => {
    if (!preview?.previewReceipt) return
    executeMutation.mutate(
      { document: document_, strategy: preview.strategy, previewReceipt: preview.previewReceipt },
      {
        onSuccess: (data) => {
          setResult(data)
          setStep('result')
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Import entries into {collectionName}</DialogTitle>
          <DialogDescription>
            {step === 'choose' &&
              'Choose an EdgeCMS collection export. The preview writes nothing; entries change only after you confirm.'}
            {step === 'preview' && `Preview of ${fileName ?? 'the file'}. Nothing has been written yet.`}
            {step === 'result' && 'The import has run. Each entry shows what happened.'}
          </DialogDescription>
        </DialogHeader>

        <ol className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground' aria-label='Import steps'>
          {(['choose', 'preview', 'result'] as const).map((value, index) => (
            <li
              key={value}
              aria-current={step === value ? 'step' : undefined}
              className={cn(step === value && 'font-semibold text-foreground')}
            >
              {index + 1}. {value === 'choose' ? 'Choose file' : value === 'preview' ? 'Review plan' : 'Results'}
            </li>
          ))}
        </ol>

        {step === 'choose' && (
          <div className='grid gap-5'>
            <div className='grid gap-2'>
              <Label htmlFor={fileInputId}>Export file (.json)</Label>
              <Input
                id={fileInputId}
                type='file'
                accept='application/json,.json'
                onChange={handleFile}
                aria-invalid={fileError ? true : undefined}
                aria-describedby={fileError ? `${fileInputId}-error` : undefined}
              />
              {fileError && (
                <p id={`${fileInputId}-error`} role='alert' className='text-sm text-destructive'>
                  {fileError}
                </p>
              )}
            </div>

            <fieldset className='grid gap-3'>
              <legend className='mb-2 text-sm font-medium'>When an entry with the same slug has different values</legend>
              <RadioGroup value={strategy} onValueChange={(value) => setStrategy(value as ImportStrategy)}>
                <div className='flex items-start gap-3'>
                  <RadioGroupItem value='skip' id={`${fileInputId}-skip`} className='mt-0.5' />
                  <Label htmlFor={`${fileInputId}-skip`} className='grid gap-1 font-normal'>
                    <span className='font-medium'>Keep the existing entry</span>
                    <span className='text-muted-foreground'>It is listed as a conflict and not changed.</span>
                  </Label>
                </div>
                <div className='flex items-start gap-3'>
                  <RadioGroupItem value='update' id={`${fileInputId}-update`} className='mt-0.5' />
                  <Label htmlFor={`${fileInputId}-update`} className='grid gap-1 font-normal'>
                    <span className='font-medium'>Update it from the file</span>
                    <span className='text-muted-foreground'>
                      Only fields in the file change. Status is not changed.
                    </span>
                  </Label>
                </div>
              </RadioGroup>
            </fieldset>

            {previewMutation.isError && (
              <Alert variant='destructive'>
                <AlertTriangle aria-hidden='true' />
                <AlertTitle>Preview failed</AlertTitle>
                <AlertDescription>{errorText(previewMutation.error)}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button variant='outline' onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={runPreview} disabled={document_ === undefined || previewMutation.isPending}>
                {previewMutation.isPending && <Loader2 className='mr-2 size-4 animate-spin' aria-hidden='true' />}
                Preview import
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'preview' && preview && (
          <PreviewStep
            preview={preview}
            executeError={executeMutation.error}
            isExecuting={executeMutation.isPending}
            isRepreviewing={previewMutation.isPending}
            onBack={() => {
              executeMutation.reset()
              setStep('choose')
            }}
            onRepreview={runPreview}
            onConfirm={runExecute}
            onClose={() => handleOpenChange(false)}
          />
        )}

        {step === 'result' && result && <ResultStep result={result} onClose={() => handleOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function SummaryTiles({ items }: { items: Array<{ label: string; value: number; className?: string }> }) {
  return (
    <dl className='grid grid-cols-3 gap-2 sm:grid-cols-5'>
      {items.map((item) => (
        <div key={item.label} className={cn('rounded-md border px-3 py-2', item.className)}>
          <dt className='text-xs'>{item.label}</dt>
          <dd className='text-xl font-semibold tabular-nums'>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <Alert>
      <AlertTriangle aria-hidden='true' />
      <AlertTitle>
        {warnings.length} warning{warnings.length === 1 ? '' : 's'}
      </AlertTitle>
      <AlertDescription>
        <ul className='list-disc space-y-1 ps-4'>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

type PreviewStepProps = {
  preview: ImportPreview
  executeError: unknown
  isExecuting: boolean
  isRepreviewing: boolean
  onBack: () => void
  onRepreview: () => void
  onConfirm: () => void
  onClose: () => void
}

function PreviewStep({
  preview,
  executeError,
  isExecuting,
  isRepreviewing,
  onBack,
  onRepreview,
  onConfirm,
  onClose,
}: PreviewStepProps) {
  const entries = sortBy(preview.entries, (entry) => ACTION_ORDER[entry.action])
  const relationCounts = { link: 0, skip: 0, conflict: 0 }
  for (const relation of preview.relations) relationCounts[relation.action] += 1
  const hasWork = Boolean(preview.previewReceipt)
  const expires = formatTime(preview.expiresAt)

  return (
    <div className='grid gap-4'>
      <section aria-labelledby='import-summary-heading' className='grid gap-2'>
        <h3 id='import-summary-heading' className='text-sm font-medium'>
          {preview.entries.length} entries in the file ·{' '}
          {preview.strategy === 'update' ? 'update entries that differ' : 'keep existing entries'}
        </h3>
        <SummaryTiles
          items={(Object.keys(ACTION_LABEL) as EntryPlanAction[]).map((action) => ({
            label: ACTION_LABEL[action],
            value: preview.summary[action] ?? 0,
            className: ACTION_CLASS[action],
          }))}
        />
        {preview.relations.length > 0 && (
          <p className='text-sm text-muted-foreground'>
            Relations: {relationCounts.link} to link, {relationCounts.skip} skipped, {relationCounts.conflict}{' '}
            conflict{relationCounts.conflict === 1 ? '' : 's'}.
          </p>
        )}
      </section>

      <Warnings warnings={preview.warnings} />

      <section aria-labelledby='import-plan-heading' className='grid gap-2'>
        <h3 id='import-plan-heading' className='text-sm font-medium'>
          Entry plan
        </h3>
        <ul className='max-h-80 divide-y overflow-y-auto rounded-md border' aria-label='Entry plan'>
          {entries.map((entry) => (
            <li key={entry.index} className='grid gap-1 px-3 py-2 text-sm' data-action={entry.action}>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant='outline' className={ACTION_CLASS[entry.action]}>
                  {ACTION_LABEL[entry.action]}
                </Badge>
                <span className='font-mono text-xs break-all'>{entry.slug || `(entry ${entry.index + 1})`}</span>
                {entry.publish && <span className='text-xs text-muted-foreground'>then publish</span>}
              </div>
              <p className='text-muted-foreground'>{entry.reason}</p>
              {entry.changedFields && entry.changedFields.length > 0 && (
                <p className='text-xs text-muted-foreground'>Fields: {entry.changedFields.join(', ')}</p>
              )}
              {entry.validationErrors && entry.validationErrors.length > 0 && (
                <ul className='list-disc ps-5 text-xs text-destructive'>
                  {entry.validationErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
              {entry.warnings?.map((warning) => (
                <p key={warning} className='text-xs text-muted-foreground'>
                  {warning}
                </p>
              ))}
            </li>
          ))}
        </ul>
      </section>

      {preview.relations.length > 0 && (
        <details className='rounded-md border px-3 py-2 text-sm'>
          <summary className='cursor-pointer font-medium'>Relation plan ({preview.relations.length})</summary>
          <ul className='mt-2 divide-y'>
            {preview.relations.map((relation) => (
              <li key={relation.index} className='flex flex-wrap items-center gap-2 py-1.5'>
                <Badge variant='outline' className={ACTION_CLASS[relation.action]}>
                  {relation.action === 'link' ? 'Link' : relation.action === 'skip' ? 'Skip' : 'Conflict'}
                </Badge>
                <span className='font-mono text-xs break-all'>
                  {relation.sourceSlug}.{relation.fieldName} → {relation.target.collectionSlug}/{relation.target.slug}
                </span>
                <span className='basis-full text-muted-foreground'>{relation.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {isPlanChanged(executeError) ? (
        <Alert variant='destructive'>
          <AlertTriangle aria-hidden='true' />
          <AlertTitle>The plan changed since this preview</AlertTitle>
          <AlertDescription>
            The file, the option or the content changed, so nothing was imported. Preview again to see the new plan.
          </AlertDescription>
        </Alert>
      ) : executeError ? (
        <Alert variant='destructive'>
          <AlertTriangle aria-hidden='true' />
          <AlertTitle>Import did not run</AlertTitle>
          <AlertDescription>{errorText(executeError)}</AlertDescription>
        </Alert>
      ) : null}

      {hasWork ? (
        <p className='text-sm text-muted-foreground'>
          Confirming runs {preview.commandCount} command{preview.commandCount === 1 ? '' : 's'} in two steps: entries,
          then relations and publishes. If one fails, the import stops and completed changes stay; there is no
          rollback.{expires ? ` This preview is valid until ${expires} and can be used once.` : ''}
        </p>
      ) : (
        <p className='text-sm font-medium'>Nothing to import: no entry or relation would change.</p>
      )}

      <DialogFooter>
        <Button variant='outline' onClick={onBack} disabled={isExecuting}>
          Back
        </Button>
        {isPlanChanged(executeError) ? (
          <Button onClick={onRepreview} disabled={isRepreviewing}>
            {isRepreviewing && <Loader2 className='mr-2 size-4 animate-spin' aria-hidden='true' />}
            Preview again
          </Button>
        ) : hasWork ? (
          <Button onClick={onConfirm} disabled={isExecuting}>
            {isExecuting && <Loader2 className='mr-2 size-4 animate-spin' aria-hidden='true' />}
            Confirm import
          </Button>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )}
      </DialogFooter>
    </div>
  )
}

/** An entry whose publish failed counts as failed, even when its create succeeded. */
function entryOutcome(entry: ImportExecution['entries'][number]): ImportOutcome | undefined {
  if (entry.outcome === 'success' && entry.publishOutcome === 'failed') return 'failed'
  return entry.outcome
}

function ResultStep({ result, onClose }: { result: ImportExecution; onClose: () => void }) {
  const counts = { success: 0, failed: 0, not_run: 0 }
  for (const entry of result.entries) {
    const outcome = entryOutcome(entry)
    if (outcome) counts[outcome] += 1
  }
  const relationFailures = result.relations.filter((relation) => relation.outcome === 'failed')
  const entries = sortBy(result.entries, (entry) => OUTCOME_ORDER[entryOutcome(entry) ?? 'none'])

  return (
    <div className='grid gap-4'>
      {result.status === 'partial_failure' ? (
        <Alert variant='destructive'>
          <AlertTriangle aria-hidden='true' />
          <AlertTitle>Import stopped partway</AlertTitle>
          <AlertDescription>
            A command failed, so the rest did not run. Changes that completed are kept; there is no rollback. Review
            the failed and not-run entries below, then preview the file again to continue.
          </AlertDescription>
        </Alert>
      ) : (
        <p className='text-sm font-medium' role='status'>
          {result.status === 'applied' ? 'Import applied.' : 'Nothing to import.'}
        </p>
      )}

      <SummaryTiles
        items={(Object.keys(OUTCOME_LABEL) as ImportOutcome[]).map((outcome) => ({
          label: OUTCOME_LABEL[outcome],
          value: counts[outcome],
          className: OUTCOME_CLASS[outcome],
        }))}
      />

      <Warnings warnings={result.warnings} />

      <ul className='max-h-80 divide-y overflow-y-auto rounded-md border' aria-label='Entry results'>
        {entries.map((entry) => (
          <li key={entry.index} className='grid gap-1 px-3 py-2 text-sm' data-outcome={entryOutcome(entry) ?? 'none'}>
            <div className='flex flex-wrap items-center gap-2'>
              {entry.outcome ? (
                <Badge variant='outline' className={OUTCOME_CLASS[entryOutcome(entry) ?? entry.outcome]}>
                  {OUTCOME_LABEL[entryOutcome(entry) ?? entry.outcome]}
                </Badge>
              ) : (
                <Badge variant='outline' className={ACTION_CLASS.skip}>
                  Not imported
                </Badge>
              )}
              <span className='text-xs text-muted-foreground'>{ACTION_LABEL[entry.action]}</span>
              <span className='font-mono text-xs break-all'>{entry.slug || `(entry ${entry.index + 1})`}</span>
              {entry.publishOutcome && (
                <span className='text-xs text-muted-foreground'>
                  {entry.outcome === 'success' ? 'saved; ' : ''}publish: {OUTCOME_LABEL[entry.publishOutcome].toLowerCase()}
                </span>
              )}
            </div>
            {entry.error ? (
              <p className='text-destructive'>{entry.error}</p>
            ) : (
              !entry.outcome && <p className='text-muted-foreground'>{entry.reason}</p>
            )}
          </li>
        ))}
      </ul>

      {relationFailures.length > 0 && (
        <div className='grid gap-1 text-sm'>
          <h3 className='font-medium'>Relations that failed</h3>
          <ul className='list-disc ps-5 text-destructive'>
            {relationFailures.map((relation) => (
              <li key={relation.index}>
                {relation.sourceSlug}.{relation.fieldName} → {relation.target.slug}: {relation.error ?? 'failed'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DialogFooter>
        <Button onClick={onClose}>Close</Button>
      </DialogFooter>
    </div>
  )
}
