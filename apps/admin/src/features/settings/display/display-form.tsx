import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { triggerSync } from '@/features/sync/sync-scheduler'
import { useCurrentTenantSlug, useTenant, useUpdateTenant } from '@/features/tenants/api'

const displayFormSchema = z.object({
  localeCatalog: z
    .array(z.string().trim().min(1, { message: 'Locale code is required.' }))
    .refine((value) => value.length > 0, {
      message: 'At least one locale is required.',
    })
    .refine((value) => new Set(value).size === value.length, {
      message: 'Locale codes must be unique.',
    }),
})

type DisplayFormValues = z.infer<typeof displayFormSchema>

export function DisplayForm() {
  const { data: activeTenantSlug } = useCurrentTenantSlug()
  const { data: activeTenant } = useTenant(activeTenantSlug ?? '')
  const updateTenant = useUpdateTenant()
  const form = useForm<DisplayFormValues>({
    resolver: zodResolver(displayFormSchema),
    defaultValues: {
      localeCatalog: ['en'],
    },
  })

  useEffect(() => {
    if (!activeTenant) return
    form.reset({
      localeCatalog: activeTenant.localeCatalog?.length ? activeTenant.localeCatalog : ['en'],
    })
  }, [activeTenant, form])

  const onSubmit = async (data: DisplayFormValues) => {
    if (!activeTenantSlug) {
      toast.error('Select a tenant first to update localization settings.')
      return
    }

    try {
      await updateTenant.mutateAsync({
        slug: activeTenantSlug,
        input: { localeCatalog: data.localeCatalog },
      })
      if (navigator.onLine) {
        void triggerSync().catch((syncError) => {
          logger.error('Failed to trigger sync after display settings submit:', syncError)
        })
      }
      toast.success('Localization settings updated.')
    } catch (error) {
      logger.error('Failed to update localization settings', error)
      toast.error('Failed to update localization settings.')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
        <FormField
          control={form.control}
          name='localeCatalog'
          render={({ field }) => (
            <FormItem>
              <div className='mb-4'>
                <FormLabel className='text-base'>Locale Catalog</FormLabel>
                <FormDescription>
                  Comma-separated locale codes available for this tenant when configuring collection
                  localization.
                </FormDescription>
              </div>
              <FormControl>
                <Input
                  value={field.value.join(', ')}
                  onChange={(event) => {
                    const parsed = event.target.value
                      .split(',')
                      .map((locale) => locale.trim())
                      .filter((locale) => locale.length > 0)
                    field.onChange(parsed)
                  }}
                  placeholder='en, fr, de'
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type='submit' disabled={updateTenant.isPending || !activeTenantSlug}>
          {updateTenant.isPending ? 'Updating...' : 'Update localization'}
        </Button>
      </form>
    </Form>
  )
}
