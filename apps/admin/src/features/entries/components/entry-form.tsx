import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CollectionDefinition } from '@/features/collections/api/collections-api'
import { useVersion, useVersionDiff } from '@/features/versioning/api'
import { RollbackDialog } from '@/features/versioning/components/rollback-dialog'
import { VersionDiff } from '@/features/versioning/components/version-diff'
import { VersionHistory } from '@/features/versioning/components/version-history'
import { slugify } from '@/lib/slugify'
import { Calendar, Clock } from 'lucide-react'
import type { Entry, EntryStatus } from '../api/entries-api'
import {
  useCancelSchedule,
  useCreateEntry,
  usePublishEntry,
  useSchedulePublish,
  useScheduleUnpublish,
  useUnpublishEntry,
  useUpdateEntry,
} from '../api/entries-api'
import { logger } from '@/lib/logger'
import {
  buildEntryFormSchema,
  buildInitialEntryData,
  getAutosaveConflictWarning,
  getFieldErrorMessage,
} from './entry-form-schema'
import { FieldRenderer } from './field-renderer'
import { LocaleSwitcher } from './locale-switcher'

type EntryFormProps = {
  collection: CollectionDefinition
  entry?: Entry
  mode: 'create' | 'edit'
  onSaved?: (slug: string) => void
}

const ENTRY_STATUSES = ['draft', 'published', 'scheduled', 'archived'] as const satisfies EntryStatus[]
const ENTRY_STATUS_LABELS = {
  draft: 'Draft',
  published: 'Published',
  scheduled: 'Scheduled',
  archived: 'Archived',
} satisfies Record<EntryStatus, string>

export function EntryForm({ collection, entry, mode, onSaved }: EntryFormProps) {
  const createMutation = useCreateEntry()
  const updateMutation = useUpdateEntry()
  const publishMutation = usePublishEntry()
  const unpublishMutation = useUnpublishEntry()
  const schedulePublishMutation = useSchedulePublish()
  const scheduleUnpublishMutation = useScheduleUnpublish()
  const cancelScheduleMutation = useCancelSchedule()

  const [lastAutosavedAt, setLastAutosavedAt] = useState<Date | null>(null)
  const [isAutosaving, setIsAutosaving] = useState(false)
  const [scheduledPublishAt, setScheduledPublishAt] = useState('')
  const [scheduledUnpublishAt, setScheduledUnpublishAt] = useState('')
  const [showScheduleControls, setShowScheduleControls] = useState(false)

  // Track latest known version to avoid 409 conflicts between background autosave and manual save
  const currentVersionRef = useRef(entry?.version ?? 1)
  useEffect(() => {
    if (entry?.version != null) {
      currentVersionRef.current = Math.max(currentVersionRef.current, entry.version)
    }
  }, [entry?.version])

  // Track active locale for editing
  const [activeLocale, setActiveLocale] = useState(collection.defaultLocale)

  const [activeTab, setActiveTab] = useState<'content' | 'history' | 'diff'>('content')
  const [selectedDiffPair, setSelectedDiffPair] = useState<{ v1: string; v2: string } | null>(null)
  const [rollbackVersion, setRollbackVersion] = useState<{
    id: string
    version: number
    timestamp: string
  } | null>(null)

  const { data: selectedVersionOne } = useVersion(entry?.id ?? '', selectedDiffPair?.v1 ?? '')
  const { data: selectedVersionTwo } = useVersion(entry?.id ?? '', selectedDiffPair?.v2 ?? '')
  const { data: versionDiffs, isLoading: isLoadingVersionDiff } = useVersionDiff(
    entry?.id ?? '',
    selectedDiffPair?.v1 ?? '',
    selectedDiffPair?.v2 ?? ''
  )
  const autosaveConflictWarning =
    mode === 'edit' && entry?.serverDraftVersion
      ? getAutosaveConflictWarning({
          localVersion: entry.version,
          remoteVersion: entry.serverDraftVersion,
        })
      : undefined

  // Check if collection has any localizable fields
  const hasLocalizableFields = useMemo(
    () => collection.fields.some((field) => field.localizable),
    [collection.fields]
  )
  // Build dynamic schema based on collection fields
  const entryFormSchema = useMemo(
    () => buildEntryFormSchema(collection.fields),
    [collection.fields]
  )

  type EntryFormValues = z.infer<typeof entryFormSchema>

  const form = useForm<EntryFormValues>({
    resolver: zodResolver(entryFormSchema),
    defaultValues: entry
      ? {
          slug: entry.slug,
          status: entry.status,
          data: entry.data as Record<string, unknown>,
        }
      : {
          slug: '',
          status: 'draft',
          data: buildInitialEntryData(collection),
        },
  })

  const { control, handleSubmit, watch, setValue, formState } = form
  const { errors, isSubmitting } = formState

  const collectionFields = useMemo(() => collection.fields, [collection.fields])
  const data = useWatch({ control, name: 'data' })
  const currentSlug = useWatch({ control, name: 'slug' })
  const titleCandidate = useWatch({ control, name: 'data.title' })
  const nameCandidate = useWatch({ control, name: 'data.name' })
  const firstTextFieldName = useMemo(
    () => collectionFields.find((field) => field.type === 'text')?.name,
    [collectionFields]
  )
  const firstTextFieldValue = useWatch({
    control,
    name: firstTextFieldName ? (`data.${firstTextFieldName}` as const) : ('data' as const),
  })

  // Auto-generate slug from watched title/name/first text field only.
  useEffect(() => {
    if (mode === 'create' && !currentSlug?.trim()) {
      const titleField = titleCandidate ?? nameCandidate
      if (titleField && typeof titleField === 'string') {
        setValue('slug', slugify(titleField))
      } else if (titleField && typeof titleField === 'object') {
        const titleValue = (titleField as Record<string, unknown>)[collection.defaultLocale]
        if (titleValue && typeof titleValue === 'string') {
          setValue('slug', slugify(titleValue))
        }
      } else {
        const fieldValue = firstTextFieldValue
        if (typeof fieldValue === 'string') {
          setValue('slug', slugify(fieldValue))
        } else if (typeof fieldValue === 'object' && fieldValue !== null) {
          const localizedValue = (fieldValue as Record<string, unknown>)[collection.defaultLocale]
          if (localizedValue && typeof localizedValue === 'string') {
            setValue('slug', slugify(localizedValue))
          }
        }
      }
    }
  }, [
    mode,
    currentSlug,
    titleCandidate,
    nameCandidate,
    firstTextFieldValue,
    setValue,
    collection.defaultLocale,
  ])

  // Detect missing translations
  const missingLocales = useMemo(() => {
    if (!data || !hasLocalizableFields) return {}

    const missing: Record<string, string[]> = {}

    for (const locale of collection.supportedLocales) {
      const missingFields: string[] = []

      for (const field of collection.fields) {
        if (field.localizable && field.required) {
          const fieldValue = data[field.name]
          if (
            !fieldValue ||
            typeof fieldValue !== 'object' ||
            !(fieldValue as Record<string, unknown>)[locale]
          ) {
            missingFields.push(field.name)
          }
        }
      }

      if (missingFields.length > 0) {
        missing[locale] = missingFields
      }
    }

    return missing
  }, [data, collectionFields, collection.supportedLocales, hasLocalizableFields])

  const onSubmit = async (formData: EntryFormValues) => {
    try {
      if (mode === 'create') {
        await createMutation.mutateAsync({
          collectionId: collection.id,
          slug: formData.slug,
          data: formData.data,
        })
        toast.success('Entry created successfully')
      } else if (entry) {
        const updated = await updateMutation.mutateAsync({
          id: entry.id,
          input: {
            slug: formData.slug,
            data: formData.data,
          },
          optimisticVersion: currentVersionRef.current,
        })
        if (updated?.version) {
          currentVersionRef.current = updated.version
        }
        toast.success('Entry updated successfully')
      }
      if (onSaved) {
        onSaved(formData.slug)
      }
    } catch (error) {
      logger.error('Form submission error:', error)
      toast.error(`Failed to ${mode === 'create' ? 'create' : 'update'} entry`)
    }
  }

  const autosaveStateRef = useRef({
    isDirty: formState.isDirty,
    isSubmitting,
    isAutosaving,
    entry,
    form,
  })
  useEffect(() => {
    autosaveStateRef.current = {
      isDirty: formState.isDirty,
      isSubmitting,
      isAutosaving,
      entry,
      form,
    }
  })

  // 30-second periodic background draft auto-save loop (C-06)
  useEffect(() => {
    if (mode !== 'edit' || !entry) return
    const interval = setInterval(async () => {
      const {
        isDirty,
        isSubmitting: submitting,
        isAutosaving: saving,
        entry: curEntry,
        form: curForm,
      } = autosaveStateRef.current
      if (isDirty && !submitting && !saving && curEntry) {
        const values = curForm.getValues()
        try {
          setIsAutosaving(true)
          const updated = await updateMutation.mutateAsync({
            id: curEntry.id,
            input: {
              slug: values.slug,
              data: values.data,
            },
            optimisticVersion: currentVersionRef.current,
          })
          if (updated?.version) {
            currentVersionRef.current = updated.version
          }
          setLastAutosavedAt(new Date())
          curForm.reset(values)
        } catch (err) {
          logger.warn('Draft background autosave failed:', err)
        } finally {
          setIsAutosaving(false)
        }
      }
    }, 30_000)

    return () => clearInterval(interval)
  }, [mode, entry?.id, updateMutation])

  const handlePublishNow = async () => {
    if (!entry) return
    try {
      await publishMutation.mutateAsync(entry.id)
      toast.success('Entry published successfully')
    } catch {
      toast.error('Failed to publish entry')
    }
  }

  const handleUnpublishNow = async () => {
    if (!entry) return
    try {
      await unpublishMutation.mutateAsync(entry.id)
      toast.success('Entry unpublished (moved to draft)')
    } catch {
      toast.error('Failed to unpublish entry')
    }
  }

  const handleSchedulePublish = async () => {
    if (!entry || !scheduledPublishAt) return
    const date = new Date(scheduledPublishAt)
    if (isNaN(date.getTime())) {
      toast.error('Please select a valid publish date and time')
      return
    }
    if (date.getTime() <= Date.now()) {
      toast.error('Scheduled publish date must be in the future')
      return
    }
    try {
      await schedulePublishMutation.mutateAsync({
        id: entry.id,
        publishAt: date.toISOString(),
      })
      toast.success('Publish scheduled successfully')
      setShowScheduleControls(false)
    } catch {
      toast.error('Failed to schedule publish')
    }
  }

  const handleScheduleUnpublish = async () => {
    if (!entry || !scheduledUnpublishAt) return
    const date = new Date(scheduledUnpublishAt)
    if (isNaN(date.getTime())) {
      toast.error('Please select a valid unpublish date and time')
      return
    }
    if (date.getTime() <= Date.now()) {
      toast.error('Scheduled unpublish date must be in the future')
      return
    }
    try {
      await scheduleUnpublishMutation.mutateAsync({
        id: entry.id,
        unpublishAt: date.toISOString(),
      })
      toast.success('Unpublish scheduled successfully')
      setShowScheduleControls(false)
    } catch {
      toast.error('Failed to schedule unpublish')
    }
  }

  const handleCancelSchedule = async () => {
    if (!entry) return
    try {
      await cancelScheduleMutation.mutateAsync(entry.id)
      toast.success('Schedule cancelled')
    } catch {
      toast.error('Failed to cancel schedule')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className='space-y-6' data-mode={mode}>
      <div className='flex items-center gap-3'>
        <p className='text-sm font-medium'>{watch('slug') || entry?.slug || 'New entry'}</p>
        {mode === 'edit' && entry && <p className='text-xs text-muted-foreground'>v{entry.version}</p>}

        {/* Auto-save indicator (C-06) */}
        {isAutosaving && (
          <span data-testid='autosave-status' className='text-xs text-muted-foreground animate-pulse'>
            Autosaving draft...
          </span>
        )}
        {!isAutosaving && lastAutosavedAt && (
          <span data-testid='autosave-status' className='text-xs text-muted-foreground'>
            Draft autosaved {lastAutosavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}

        {/* Publishing & Scheduling controls for edit mode (C-07) */}
        {mode === 'edit' && entry ? (
          <div className='ml-auto flex items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='h-8 px-2.5 text-xs'
              onClick={() => setShowScheduleControls((prev) => !prev)}
            >
              <Calendar className='mr-1.5 size-3.5' />
              Schedule
            </Button>
            {entry.status === 'published' ? (
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-8 px-3'
                disabled={unpublishMutation.isPending}
                onClick={handleUnpublishNow}
              >
                {unpublishMutation.isPending ? 'Unpublishing...' : 'Unpublish'}
              </Button>
            ) : (
              <Button
                type='button'
                variant='secondary'
                size='sm'
                className='h-8 px-3'
                disabled={publishMutation.isPending}
                onClick={handlePublishNow}
              >
                {publishMutation.isPending ? 'Publishing...' : 'Publish'}
              </Button>
            )}
            <Button type='submit' disabled={isSubmitting} size='sm' className='h-8 px-3'>
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </div>
        ) : (
          <Button type='submit' disabled={isSubmitting} size='sm' className='ml-auto h-8 px-3'>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        )}
      </div>

      {/* Scheduled Publishing Panel (C-07) */}
      {showScheduleControls && mode === 'edit' && entry && (
        <Card data-testid='scheduling-panel' className='border-primary/20 bg-muted/40'>
          <CardContent className='space-y-4 p-4'>
            <div className='flex items-center justify-between'>
              <h4 className='text-sm font-semibold flex items-center gap-2'>
                <Clock className='size-4 text-primary' />
                Scheduled Publishing & Unpublishing
              </h4>
              {entry.status === 'scheduled' && (
                <Button
                  type='button'
                  variant='destructive'
                  size='sm'
                  className='h-7 text-xs'
                  disabled={cancelScheduleMutation.isPending}
                  onClick={handleCancelSchedule}
                >
                  Cancel Active Schedule
                </Button>
              )}
            </div>

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label htmlFor='schedule-publish-at' className='text-xs'>
                  Publish Date & Time
                </Label>
                <div className='flex gap-2'>
                  <Input
                    id='schedule-publish-at'
                    type='datetime-local'
                    value={scheduledPublishAt}
                    onChange={(e) => setScheduledPublishAt(e.target.value)}
                    className='h-8 text-xs'
                  />
                  <Button
                    type='button'
                    size='sm'
                    className='h-8 text-xs'
                    disabled={!scheduledPublishAt || schedulePublishMutation.isPending}
                    onClick={handleSchedulePublish}
                  >
                    Schedule
                  </Button>
                </div>
              </div>

              {entry.status === 'published' && (
                <div className='space-y-1.5'>
                  <Label htmlFor='schedule-unpublish-at' className='text-xs'>
                    Unpublish Date & Time
                  </Label>
                  <div className='flex gap-2'>
                    <Input
                      id='schedule-unpublish-at'
                      type='datetime-local'
                      value={scheduledUnpublishAt}
                      onChange={(e) => setScheduledUnpublishAt(e.target.value)}
                      className='h-8 text-xs'
                    />
                    <Button
                      type='button'
                      size='sm'
                      className='h-8 text-xs'
                      disabled={!scheduledUnpublishAt || scheduleUnpublishMutation.isPending}
                      onClick={handleScheduleUnpublish}
                    >
                      Schedule
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {autosaveConflictWarning && (
        <p className='rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900'>
          {autosaveConflictWarning}
        </p>
      )}

      <div className='space-y-4'>
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as typeof activeTab)}
          className='gap-3'
        >
          <TabsList className='w-fit'>
            <TabsTrigger value='content'>Content</TabsTrigger>
            {mode === 'edit' && entry && <TabsTrigger value='history'>History</TabsTrigger>}
            {mode === 'edit' && entry && selectedDiffPair && <TabsTrigger value='diff'>Diff</TabsTrigger>}
          </TabsList>

          <TabsContent value='content' className='space-y-4'>
            <Card>
              <CardContent className='space-y-6 p-5 sm:p-6'>
                {hasLocalizableFields && (
                  <LocaleSwitcher
                    locales={collection.supportedLocales}
                    defaultLocale={collection.defaultLocale}
                    activeLocale={activeLocale}
                    onLocaleChange={setActiveLocale}
                    missingLocales={missingLocales}
                  />
                )}

                <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <div className='space-y-2'>
                    <Label htmlFor='entry-slug'>Slug</Label>
                    <Controller
                      name='slug'
                      control={control}
                      render={({ field: controllerField }) => (
                        <Input
                          id='entry-slug'
                          value={controllerField.value}
                          onChange={controllerField.onChange}
                          placeholder='entry-slug'
                          disabled={isSubmitting}
                        />
                      )}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='entry-status'>Status</Label>
                    <Controller
                      name='status'
                      control={control}
                      render={({ field: controllerField }) => (
                        <Select
                          value={controllerField.value}
                          onValueChange={controllerField.onChange}
                          disabled
                        >
                          <SelectTrigger id='entry-status' data-testid='entry-status-trigger'>
                            <SelectValue placeholder='Select status' />
                          </SelectTrigger>
                          <SelectContent>
                            {ENTRY_STATUSES.map((status) => (
                              <SelectItem key={status} value={status}>
                                {ENTRY_STATUS_LABELS[status]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <p className='text-xs text-muted-foreground'>
                      Use publishing actions to change lifecycle status.
                    </p>
                  </div>
                </div>

                <div data-testid='entry-content-layout' className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
                  {collectionFields.map((field) => {
                    const width = (field.options?.width as string | undefined) ?? 'half'
                    const widthClass = width === 'full' ? 'md:col-span-2' : 'md:col-span-1'

                    return (
                      <div key={field.name} className={widthClass}>
                        <Controller
                          name={`data.${field.name}` as const}
                          control={control}
                          render={({ field: controllerField }) => (
                            <FieldRenderer
                              field={field}
                              value={controllerField.value}
                              onChange={controllerField.onChange}
                              error={getFieldErrorMessage(errors.data, field.name, activeLocale)}
                              disabled={isSubmitting}
                              entryId={entry?.id}
                              collectionId={collection.id}
                              activeLocale={activeLocale}
                            />
                          )}
                        />
                      </div>
                    )
                  })}
                </div>

                {collection.fields.length === 0 && (
                  <p className='text-muted-foreground text-center py-8'>
                    No fields defined for this collection.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {mode === 'edit' && entry && (
            <TabsContent value='history'>
              <Card>
                <CardContent className='p-0'>
                  <VersionHistory
                    entryId={entry.id}
                    currentVersion={entry.version}
                    isOpen={true}
                    onToggle={() => {}}
                    onDiffRequest={(v1, v2) => {
                      setSelectedDiffPair({ v1, v2 })
                      setActiveTab('diff')
                    }}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {mode === 'edit' && entry && selectedDiffPair && (
            <TabsContent value='diff'>
              <Card>
                <CardContent className='space-y-4 p-5 sm:p-6'>
                  <h3 className='text-sm font-medium text-muted-foreground'>Version Diff</h3>
                  {isLoadingVersionDiff ? (
                    <p className='text-sm text-muted-foreground'>Loading diff...</p>
                  ) : (
                    <VersionDiff
                      diffs={versionDiffs ?? []}
                      olderVersion={selectedVersionOne?.version ?? 0}
                      newerVersion={selectedVersionTwo?.version ?? 0}
                      onRollback={() => {
                        if (!selectedVersionOne) return
                        setRollbackVersion({
                          id: selectedVersionOne.id,
                          version: selectedVersionOne.version,
                          timestamp: selectedVersionOne.createdAt,
                        })
                      }}
                      rollbackDisabled={!selectedVersionOne}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {mode === 'edit' && entry && (
        <RollbackDialog
          entryId={entry.id}
          version={rollbackVersion}
          onClose={() => setRollbackVersion(null)}
        />
      )}
    </form>
  )
}
