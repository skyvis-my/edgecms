import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Copy } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { triggerSync } from '@/features/sync/sync-scheduler'
import { CANONICAL_LOCALES } from '@/lib/locales'
import { slugify } from '@/lib/slugify'
import { useCurrentTenantSlug, useTenant } from '@/features/tenants/api'
import { logger } from '@/lib/logger'
import {
  type CollectionDefinition,
  FIELD_TYPES,
  useCreateCollection,
  useUpdateCollection,
} from '../api/collections-api'
import { generateCollectionConfigExport } from './collection-config-export'
import { FieldEditor } from './field-editor'

const collectionFieldTypes = [...FIELD_TYPES] as [
  (typeof FIELD_TYPES)[number],
  ...(typeof FIELD_TYPES)[number][],
]

const collectionFormSchema = z.object({
  name: z.string().min(1, 'Collection name is required'),
  slug: z.string().min(1, 'Slug is required'),
  singleton: z.boolean(),
  fields: z.array(
    z.object({
      name: z.string().min(1, 'Field name is required'),
      type: z.enum(collectionFieldTypes),
      required: z.boolean(),
      localizable: z.boolean(),
      options: z.record(z.string(), z.unknown()).optional(),
    })
  ),
})

export type CollectionFormValues = z.infer<typeof collectionFormSchema>

type CollectionFormProps = {
  collection?: CollectionDefinition
  mode: 'create' | 'edit'
  createSingleton?: boolean
}

export function CollectionForm({ collection, mode, createSingleton = false }: CollectionFormProps) {
  const navigate = useNavigate()
  const createMutation = useCreateCollection()
  const updateMutation = useUpdateCollection()
  const { data: activeTenantSlug } = useCurrentTenantSlug()
  const collectionsPath = activeTenantSlug
    ? `/tenants/${activeTenantSlug}/collections`
    : '/admin/tenants'
  const { data: activeTenant } = useTenant(activeTenantSlug ?? '')
  const localeOptions = (
    activeTenant?.localeCatalog?.length
      ? activeTenant.localeCatalog
      : CANONICAL_LOCALES.map((locale) => locale.value)
  ).map((locale) => ({
    value: locale,
    label:
      CANONICAL_LOCALES.find((item) => item.value === locale)?.label ?? locale.toUpperCase(),
  }))
  const supportedLocaleValues = localeOptions.map((locale) => locale.value)

  const form = useForm<CollectionFormValues>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: collection
      ? {
          name: collection.name,
          slug: collection.slug,
          singleton: collection.singleton,
          fields: collection.fields,
        }
      : {
          name: '',
          slug: '',
          singleton: createSingleton,
          fields: [],
        },
  })

  const { register, control, handleSubmit, watch, setValue, formState } = form
  const { errors, isSubmitting } = formState

  // Auto-generate slug from name
  const name = watch('name')
  const currentValues = watch()
  const configExport = generateCollectionConfigExport({
    ...currentValues,
    defaultLocale:
      supportedLocaleValues[0] ?? collection?.defaultLocale ?? activeTenant?.localeCatalog?.[0] ?? 'en',
    supportedLocales: supportedLocaleValues.length ? supportedLocaleValues : ['en'],
  })
  useEffect(() => {
    if (mode === 'create' && name) {
      setValue('slug', slugify(name))
    }
  }, [name, mode, setValue])

  const onSubmit = async (data: CollectionFormValues) => {
    const defaultLocale =
      supportedLocaleValues[0] ?? collection?.defaultLocale ?? activeTenant?.localeCatalog?.[0] ?? 'en'
    const localePayload = {
      defaultLocale,
      supportedLocales: supportedLocaleValues.length ? supportedLocaleValues : ['en'],
    }

    try {
      if (mode === 'create') {
        await createMutation.mutateAsync({
          ...data,
          ...localePayload,
        })
        toast.success('Collection created successfully')
      } else if (collection) {
        const { slug: _slug, ...updateInput } = data
        await updateMutation.mutateAsync({
          id: collection.id,
          input: {
            ...updateInput,
            ...localePayload,
          },
        })
        toast.success('Collection updated successfully')
      }
      if (navigator.onLine) {
        void triggerSync().catch((syncError) => {
          logger.error('Failed to trigger sync after collection submit:', syncError)
        })
      }
      navigate({ to: collectionsPath })
    } catch (error) {
      // Error is handled by the mutation's error handler
      logger.error('Form submission error:', error)
    }
  }

  const copyConfigExport = async () => {
    if (!navigator.clipboard) {
      toast.error('Clipboard is unavailable in this browser')
      return
    }

    try {
      await navigator.clipboard.writeText(configExport)
      toast.success('Collection config copied')
    } catch (error) {
      logger.error('Failed to copy collection config export:', error)
      toast.error('Failed to copy collection config')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>Define the collection name and type</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='name'>Collection Name</Label>
              <Input
                {...register('name')}
                id='name'
                placeholder='e.g., Blog Posts, Products'
                disabled={isSubmitting}
              />
              {errors.name && <p className='text-sm text-red-600' role='alert' aria-live='polite'>{errors.name.message}</p>}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='slug'>Slug</Label>
              <Input
                {...register('slug')}
                id='slug'
                placeholder='Auto-generated from name'
                disabled={isSubmitting}
              />
              {errors.slug && <p className='text-sm text-red-600' role='alert' aria-live='polite'>{errors.slug.message}</p>}
              <p className='text-xs text-muted-foreground'>
                Public API path: /api/tenants/{activeTenantSlug ?? 'tenant'}/api/public/{watch('slug') || 'collection-slug'}
              </p>
            </div>
          </div>

          {mode === 'edit' && (
            <div className='flex items-center space-x-2'>
              <Switch
                id='singleton'
                checked={watch('singleton')}
                onCheckedChange={(checked) => setValue('singleton', checked)}
                disabled={isSubmitting}
              />
              <div className='space-y-0.5'>
                <Label htmlFor='singleton' className='cursor-pointer font-normal'>
                  Singleton Collection
                </Label>
                <p className='text-xs text-muted-foreground'>
                  Enable this for single-entry collections like site settings or homepage content
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fields</CardTitle>
          <CardDescription>Define the structure of your content entries</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldEditor control={control} setValue={setValue} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
            <div className='space-y-1.5'>
              <CardTitle>Developer Export</CardTitle>
              <CardDescription>Copy the current collection config as TypeScript</CardDescription>
            </div>
            <Button type='button' variant='outline' onClick={copyConfigExport} disabled={isSubmitting}>
              <Copy className='mr-2 size-4' />
              Copy Config
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <pre className='max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground'>
            <code>{configExport}</code>
          </pre>
        </CardContent>
      </Card>

      <div className='flex justify-end gap-3'>
        <Button
          type='button'
          variant='outline'
          onClick={() => navigate({ to: collectionsPath })}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type='submit' disabled={isSubmitting}>
          {isSubmitting
            ? 'Saving...'
            : mode === 'create'
              ? 'Create Collection'
              : 'Update Collection'}
        </Button>
      </div>
    </form>
  )
}
