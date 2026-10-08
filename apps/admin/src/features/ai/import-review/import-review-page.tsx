import { Check, FileText, Loader2, Play, Upload, WandSparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  useAnalyzeImportBatch,
  useApplySuggestionSet,
  useCreateImportBatch,
  useDryRunSuggestionSet,
  useImportBatch,
  useUpdateSuggestion,
  useUploadImportSource,
  type AiSuggestion,
} from '../api'

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'accepted' || status === 'ready' || status === 'ready_for_review') return 'default'
  if (status === 'rejected' || status === 'failed' || status === 'unsupported') return 'destructive'
  if (status === 'warning') return 'outline'
  return 'secondary'
}

function SuggestionRow({
  batchId,
  suggestion,
}: {
  batchId: string
  suggestion: AiSuggestion
}) {
  const updateSuggestion = useUpdateSuggestion()
  const [editedValue, setEditedValue] = useState(
    stringifyValue(suggestion.editedValueJson ?? suggestion.suggestedValueJson)
  )
  const accepted = suggestion.status === 'accepted'
  const disabled = suggestion.status === 'warning' || updateSuggestion.isPending

  return (
    <TableRow>
      <TableCell className='align-top'>
        <Checkbox
          checked={accepted}
          disabled={disabled}
          onCheckedChange={(checked) => {
            updateSuggestion.mutate({
              batchId,
              suggestionId: suggestion.id,
              status: checked ? 'accepted' : 'pending',
              editedValue,
            })
          }}
        />
      </TableCell>
      <TableCell className='align-top'>
        <div className='space-y-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <Badge variant={statusVariant(suggestion.status)}>{suggestion.status}</Badge>
            <Badge variant='outline'>{suggestion.operation.replace('_', ' ')}</Badge>
            {suggestion.locale ? <Badge variant='secondary'>{suggestion.locale}</Badge> : null}
          </div>
          <div className='text-sm font-medium'>{suggestion.fieldPath ?? 'New entry'}</div>
          {suggestion.warning ? (
            <div className='text-xs text-destructive'>{suggestion.warning}</div>
          ) : null}
        </div>
      </TableCell>
      <TableCell className='align-top'>
        <Textarea
          value={editedValue}
          disabled={disabled}
          className='min-h-24 font-mono text-xs'
          onChange={(event) => setEditedValue(event.target.value)}
          onBlur={() => {
            if (!disabled) {
              updateSuggestion.mutate({
                batchId,
                suggestionId: suggestion.id,
                editedValue,
              })
            }
          }}
        />
      </TableCell>
      <TableCell className='align-top text-sm'>{suggestion.confidence}%</TableCell>
      <TableCell className='align-top'>
        <div className='max-w-64 space-y-1 text-xs text-muted-foreground'>
          {(suggestion.citationsJson ?? []).slice(0, 3).map((citation) => (
            <div key={citation.id}>
              <span className='font-medium text-foreground'>{citation.label}</span>
              {citation.snippet ? `: ${citation.snippet}` : null}
            </div>
          ))}
        </div>
      </TableCell>
      <TableCell className='align-top'>
        <div className='flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={disabled}
            onClick={() =>
              updateSuggestion.mutate({
                batchId,
                suggestionId: suggestion.id,
                status: 'accepted',
                editedValue,
              })
            }
          >
            <Check className='size-4' />
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={updateSuggestion.isPending}
            onClick={() =>
              updateSuggestion.mutate({
                batchId,
                suggestionId: suggestion.id,
                status: 'rejected',
                editedValue,
              })
            }
          >
            <X className='size-4' />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

export function ImportReviewPage() {
  const [batchId, setBatchId] = useState<string>()
  const [intent, setIntent] = useState('')
  const [targetCollectionSlug, setTargetCollectionSlug] = useState('')
  const [targetEntryId, setTargetEntryId] = useState('')
  const [sourceLocale, setSourceLocale] = useState('en')
  const [targetLocales, setTargetLocales] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dryRunHash, setDryRunHash] = useState<string>()

  const createBatch = useCreateImportBatch()
  const uploadSource = useUploadImportSource()
  const analyzeBatch = useAnalyzeImportBatch()
  const dryRunSet = useDryRunSuggestionSet()
  const applySet = useApplySuggestionSet()
  const batchQuery = useImportBatch(batchId)
  const detail = batchQuery.data

  const acceptedCount = useMemo(
    () => detail?.suggestions.rows.filter((suggestion) => suggestion.status === 'accepted').length ?? 0,
    [detail]
  )
  const suggestionSetId = detail?.suggestionSet?.id
  const canDryRun = Boolean(suggestionSetId && acceptedCount > 0)
  const canApply = Boolean(suggestionSetId && (dryRunHash || detail?.suggestionSet?.dryRunHash))

  async function startImport() {
    const created = await createBatch.mutateAsync({
      intent,
      targetCollectionSlug: targetCollectionSlug || undefined,
      targetEntryId: targetEntryId || undefined,
      sourceLocale,
      targetLocales: targetLocales
        .split(',')
        .map((locale) => locale.trim())
        .filter(Boolean),
    })
    setBatchId(created.batch.id)
    if (sourceText.trim()) {
      await uploadSource.mutateAsync({ batchId: created.batch.id, text: sourceText })
    }
    if (file) {
      await uploadSource.mutateAsync({ batchId: created.batch.id, file })
    }
    await analyzeBatch.mutateAsync(created.batch.id)
  }

  return (
    <div className='flex flex-col gap-6 p-6'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-normal'>AI Import Review</h1>
          <p className='text-sm text-muted-foreground'>
            Suggestions only. Nothing changes until dry-run passes and selected changes are applied.
          </p>
        </div>
        {detail?.batch.status ? (
          <Badge variant={statusVariant(detail.batch.status)}>{detail.batch.status}</Badge>
        ) : null}
      </div>

      <section className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Intake</CardTitle>
          </CardHeader>
          <CardContent className='grid gap-4'>
            <div className='grid gap-2'>
              <Label htmlFor='intent'>Intent</Label>
              <Textarea
                id='intent'
                value={intent}
                onChange={(event) => setIntent(event.target.value)}
                placeholder='Turn this brochure into draft product content.'
              />
            </div>
            <div className='grid gap-4 md:grid-cols-2'>
              <div className='grid gap-2'>
                <Label htmlFor='targetCollectionSlug'>Target collection slug</Label>
                <Input
                  id='targetCollectionSlug'
                  value={targetCollectionSlug}
                  onChange={(event) => setTargetCollectionSlug(event.target.value)}
                  placeholder='products'
                />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='targetEntryId'>Existing entry id</Label>
                <Input
                  id='targetEntryId'
                  value={targetEntryId}
                  onChange={(event) => setTargetEntryId(event.target.value)}
                  placeholder='optional'
                />
              </div>
            </div>
            <div className='grid gap-4 md:grid-cols-2'>
              <div className='grid gap-2'>
                <Label htmlFor='sourceLocale'>Source locale</Label>
                <Input
                  id='sourceLocale'
                  value={sourceLocale}
                  onChange={(event) => setSourceLocale(event.target.value)}
                />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='targetLocales'>Target locales</Label>
                <Input
                  id='targetLocales'
                  value={targetLocales}
                  onChange={(event) => setTargetLocales(event.target.value)}
                  placeholder='ms-MY, zh-CN'
                />
              </div>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='sourceText'>Raw text</Label>
              <Textarea
                id='sourceText'
                value={sourceText}
                className='min-h-32'
                onChange={(event) => setSourceText(event.target.value)}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='sourceFile'>File source</Label>
              <Input
                id='sourceFile'
                type='file'
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <Button
              className='w-fit gap-2'
              disabled={
                createBatch.isPending ||
                uploadSource.isPending ||
                analyzeBatch.isPending ||
                !intent.trim() ||
                !targetCollectionSlug.trim() ||
                (!sourceText.trim() && !file)
              }
              onClick={startImport}
            >
              {createBatch.isPending || uploadSource.isPending || analyzeBatch.isPending ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                <WandSparkles className='size-4' />
              )}
              Analyze
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Analysis Progress</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='space-y-2'>
              {(detail?.sources ?? []).length === 0 ? (
                <div className='text-sm text-muted-foreground'>Ready for first import</div>
              ) : (
                detail?.sources.map((source) => (
                  <div key={source.id} className='flex items-center justify-between gap-3 text-sm'>
                    <span className='flex min-w-0 items-center gap-2'>
                      {source.kind === 'file' ? <Upload className='size-4' /> : <FileText className='size-4' />}
                      <span className='truncate'>{source.filename ?? source.kind}</span>
                    </span>
                    <Badge variant={statusVariant(source.extractionStatus)}>{source.extractionStatus}</Badge>
                  </div>
                ))
              )}
            </div>
            <Separator />
            <div className='space-y-2 text-sm'>
              <div>Source locale: {detail?.localeMatrix.sourceLocale ?? sourceLocale}</div>
              <div>
                Target locales:{' '}
                {detail?.localeMatrix.targetLocales.length
                  ? detail.localeMatrix.targetLocales.join(', ')
                  : 'none'}
              </div>
              {detail?.warnings.map((warning) => (
                <div key={warning} className='text-destructive'>
                  {warning}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className='space-y-3'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <h2 className='text-lg font-semibold tracking-normal'>Suggestion Review</h2>
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              disabled={!canDryRun || dryRunSet.isPending}
              onClick={async () => {
                if (!suggestionSetId || !batchId) return
                const result = await dryRunSet.mutateAsync({ suggestionSetId, batchId })
                setDryRunHash(result.dryRunHash)
              }}
            >
              <Play className='size-4' />
              Dry-run
            </Button>
            <Button
              disabled={!canApply || applySet.isPending}
              onClick={() => {
                if (!suggestionSetId || !batchId) return
                applySet.mutate({
                  suggestionSetId,
                  batchId,
                  dryRunHash: dryRunHash ?? detail?.suggestionSet?.dryRunHash ?? '',
                })
              }}
            >
              Apply selected
            </Button>
          </div>
        </div>
        <div className='overflow-hidden rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-12'>Accept</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Suggested value</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Citations</TableHead>
                <TableHead className='w-28'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(detail?.suggestions.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className='h-24 text-center text-muted-foreground'>
                    Ready for first import
                  </TableCell>
                </TableRow>
              ) : (
                detail?.suggestions.rows.map((suggestion) => (
                  <SuggestionRow key={suggestion.id} batchId={detail.batch.id} suggestion={suggestion} />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className='space-y-3'>
        <h2 className='text-lg font-semibold tracking-normal'>Apply Preview</h2>
        <div className='rounded-md border p-4 text-sm'>
          {dryRunSet.data ? (
            <div className='space-y-2'>
              <div>Command count: {dryRunSet.data.commands.length}</div>
              <div>Dry-run hash: {dryRunSet.data.dryRunHash}</div>
              <pre className='max-h-72 overflow-auto rounded bg-muted p-3 text-xs'>
                {JSON.stringify(dryRunSet.data.commandResults, null, 2)}
              </pre>
            </div>
          ) : (
            <div className='text-muted-foreground'>Accept suggestions, then run preview.</div>
          )}
        </div>
      </section>
    </div>
  )
}
