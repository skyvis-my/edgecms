import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Copy, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { triggerSync } from '@/features/sync/sync-scheduler'
import { useCurrentTenantSlug } from '@/features/tenants/api'
import { logger } from '@/lib/logger'
import {
  useCreateWebhook,
  useTestWebhook,
  useUpdateWebhook,
  type WebhookDefinition,
  type WebhookEventType,
} from './api'

const EVENT_TYPES: { value: WebhookEventType; label: string }[] = [
  { value: 'entry.created', label: 'Entry Created' },
  { value: 'entry.updated', label: 'Entry Updated' },
  { value: 'entry.deleted', label: 'Entry Deleted' },
  { value: 'entry.published', label: 'Entry Published' },
  { value: 'entry.unpublished', label: 'Entry Unpublished' },
  { value: 'entry.scheduled', label: 'Entry Scheduled' },
  { value: 'relation.linked', label: 'Relation Linked' },
  { value: 'relation.unlinked', label: 'Relation Unlinked' },
  { value: 'collection.created', label: 'Collection Created' },
  { value: 'collection.updated', label: 'Collection Updated' },
  { value: 'collection.deleted', label: 'Collection Deleted' },
  { value: 'entry.bulk_updated', label: 'Entry Bulk Updated' },
]

const webhookFormSchema = z.object({
  url: z.string().url('Must be a valid URL').startsWith('https://', 'URL must use HTTPS'),
  events: z.array(z.string()).min(1, 'At least one event must be selected'),
  customHeaders: z.array(
    z.object({
      key: z.string().min(1, 'Header key is required'),
      value: z.string().min(1, 'Header value is required'),
    })
  ),
  retryConfig: z.object({
    maxRetries: z.number().int().min(0).max(10),
    timeout: z.number().int().min(1000).max(60000),
  }),
  status: z.enum(['enabled', 'disabled']),
})

export type WebhookFormValues = z.infer<typeof webhookFormSchema>

type WebhookFormProps = {
  webhook?: WebhookDefinition
  mode: 'create' | 'edit'
}

export function WebhookForm({ webhook, mode }: WebhookFormProps) {
  const navigate = useNavigate()
  const { data: tenantSlug } = useCurrentTenantSlug()
  const webhooksPath = tenantSlug ? `/tenants/${tenantSlug}/webhooks` : '/webhooks'
  const createMutation = useCreateWebhook()
  const updateMutation = useUpdateWebhook()
  const testMutation = useTestWebhook()
  const [testResult, setTestResult] = useState<{
    statusCode: number
    body: string
    success: boolean
  } | null>(null)

  const customHeadersArray = webhook?.customHeaders
    ? Object.entries(webhook.customHeaders).map(([key, value]) => ({ key, value }))
    : []

  const form = useForm<WebhookFormValues>({
    resolver: zodResolver(webhookFormSchema),
    defaultValues: webhook
      ? {
          url: webhook.url,
          events: webhook.events,
          customHeaders: customHeadersArray,
          retryConfig: webhook.retryConfig,
          status: webhook.status,
        }
      : {
          url: '',
          events: [],
          customHeaders: [],
          retryConfig: {
            maxRetries: 3,
            timeout: 5000,
          },
          status: 'enabled',
        },
  })

  const { register, control, handleSubmit, watch, setValue, formState } = form
  const { errors, isSubmitting } = formState

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'customHeaders',
  })

  const selectedEvents = watch('events')

  const toggleEvent = (event: string) => {
    const current = selectedEvents
    if (current.includes(event)) {
      setValue(
        'events',
        current.filter((e) => e !== event)
      )
    } else {
      setValue('events', [...current, event])
    }
  }

  const onSubmit = async (data: WebhookFormValues) => {
    try {
      const customHeaders = data.customHeaders.reduce(
        (acc, { key, value }) => {
          acc[key] = value
          return acc
        },
        {} as Record<string, string>
      )

      const input = {
        url: data.url,
        events: data.events as WebhookEventType[],
        customHeaders,
        retryConfig: data.retryConfig,
        status: data.status,
      }

      if (mode === 'create') {
        await createMutation.mutateAsync(input)
        toast.success('Webhook created successfully')
      } else if (webhook) {
        await updateMutation.mutateAsync({ id: webhook.id, input })
        toast.success('Webhook updated successfully')
      }
      if (navigator.onLine) {
        void triggerSync().catch((syncError) => {
          logger.error('Failed to trigger sync after webhook submit:', syncError)
        })
      }
      navigate({ to: webhooksPath })
    } catch (error) {
      logger.error('Form submission error:', error)
    }
  }

  const handleTest = async () => {
    if (!webhook) {
      toast.error('Save the webhook first before testing')
      return
    }

    try {
      const result = await testMutation.mutateAsync(webhook.id)
      setTestResult(result)
      if (result.success) {
        toast.success('Test delivery successful')
      } else {
        toast.error('Test delivery failed')
      }
    } catch {
      toast.error('Failed to test webhook')
    }
  }

  const copySecret = () => {
    if (webhook?.secret) {
      navigator.clipboard.writeText(webhook.secret)
      toast.success('Secret copied to clipboard')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>Webhook Configuration</CardTitle>
          <CardDescription>Configure the webhook endpoint and delivery settings</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='url'>Endpoint URL</Label>
            <Input
              {...register('url')}
              id='url'
              placeholder='https://example.com/webhook'
              disabled={isSubmitting}
            />
            {errors.url && <p className='text-sm text-red-600'>{errors.url.message}</p>}
            <p className='text-xs text-muted-foreground'>
              The HTTPS endpoint that will receive webhook events
            </p>
          </div>

          {webhook && (
            <div className='space-y-2'>
              <Label htmlFor='secret'>Webhook Secret</Label>
              <div className='flex gap-2'>
                <Input
                  id='secret'
                  value={webhook.secret}
                  readOnly
                  disabled
                  className='font-mono text-sm'
                />
                <Button type='button' variant='outline' size='icon' onClick={copySecret}>
                  <Copy className='h-4 w-4' />
                  <span className='sr-only'>Copy secret</span>
                </Button>
              </div>
              <p className='text-xs text-muted-foreground'>
                Use this secret to verify webhook signatures
              </p>
              <div className='rounded-md border bg-muted/40 p-3 space-y-1'>
                <p className='text-xs font-medium'>Signature headers</p>
                <p className='text-xs text-muted-foreground'>
                  EdgeCMS sends <code>x-edgecms-signature</code> and <code>x-webhook-signature</code>{' '}
                  with format <code>sha256=&lt;hex&gt;</code>.
                </p>
              </div>
            </div>
          )}

          <div className='flex items-center space-x-2'>
            <Switch
              id='status'
              checked={watch('status') === 'enabled'}
              onCheckedChange={(checked) => setValue('status', checked ? 'enabled' : 'disabled')}
              disabled={isSubmitting}
            />
            <div className='space-y-0.5'>
              <Label htmlFor='status' className='cursor-pointer font-normal'>
                Enable Webhook
              </Label>
              <p className='text-xs text-muted-foreground'>
                Disabled webhooks will not receive events
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Event Subscriptions</CardTitle>
          <CardDescription>Select which events will trigger this webhook</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
            {EVENT_TYPES.map((event) => (
              <div key={event.value} className='flex items-center space-x-2'>
                <Checkbox
                  id={`event-${event.value}`}
                  checked={selectedEvents.includes(event.value)}
                  onCheckedChange={() => toggleEvent(event.value)}
                  disabled={isSubmitting}
                />
                <Label
                  htmlFor={`event-${event.value}`}
                  className='text-sm font-normal cursor-pointer'
                >
                  {event.label}
                </Label>
              </div>
            ))}
          </div>
          {errors.events && <p className='text-sm text-red-600'>{errors.events.message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom Headers</CardTitle>
          <CardDescription>Add custom HTTP headers to webhook requests</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {fields.map((field, index) => (
            <div key={field.id} className='flex gap-2'>
              <div className='flex-1 space-y-2'>
                <Input
                  {...register(`customHeaders.${index}.key`)}
                  placeholder='Header name'
                  disabled={isSubmitting}
                />
                {errors.customHeaders?.[index]?.key && (
                  <p className='text-sm text-red-600'>
                    {errors.customHeaders[index]?.key?.message}
                  </p>
                )}
              </div>
              <div className='flex-1 space-y-2'>
                <Input
                  {...register(`customHeaders.${index}.value`)}
                  placeholder='Header value'
                  disabled={isSubmitting}
                />
                {errors.customHeaders?.[index]?.value && (
                  <p className='text-sm text-red-600'>
                    {errors.customHeaders[index]?.value?.message}
                  </p>
                )}
              </div>
              <Button
                type='button'
                variant='outline'
                size='icon'
                onClick={() => remove(index)}
                disabled={isSubmitting}
              >
                <X className='h-4 w-4' />
                <span className='sr-only'>Remove header</span>
              </Button>
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            onClick={() => append({ key: '', value: '' })}
            disabled={isSubmitting}
          >
            <Plus className='mr-2 h-4 w-4' />
            Add Header
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retry Configuration</CardTitle>
          <CardDescription>Configure retry behavior for failed deliveries</CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='maxRetries'>Max Retries</Label>
              <Input
                {...register('retryConfig.maxRetries', { valueAsNumber: true })}
                id='maxRetries'
                type='number'
                min='0'
                max='10'
                disabled={isSubmitting}
              />
              {errors.retryConfig?.maxRetries && (
                <p className='text-sm text-red-600'>{errors.retryConfig.maxRetries.message}</p>
              )}
            </div>
            <div className='space-y-2'>
              <Label htmlFor='timeout'>Timeout (ms)</Label>
              <Input
                {...register('retryConfig.timeout', { valueAsNumber: true })}
                id='timeout'
                type='number'
                min='1000'
                max='60000'
                step='1000'
                disabled={isSubmitting}
              />
              {errors.retryConfig?.timeout && (
                <p className='text-sm text-red-600'>{errors.retryConfig.timeout.message}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {mode === 'edit' && webhook && (
        <Card>
          <CardHeader>
            <CardTitle>Test Webhook</CardTitle>
            <CardDescription>Send a test event to verify webhook configuration</CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <Button
              type='button'
              variant='outline'
              onClick={handleTest}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? 'Testing...' : 'Send Test Event'}
            </Button>
            {testResult && (
              <div className='rounded-md border p-4 space-y-2'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium'>Status Code:</span>
                  <span className={testResult.success ? 'text-green-600' : 'text-red-600'}>
                    {testResult.statusCode}
                  </span>
                </div>
                <div className='space-y-1'>
                  <span className='font-medium'>Response:</span>
                  <pre className='text-xs bg-muted p-2 rounded overflow-auto max-h-32'>
                    {testResult.body}
                  </pre>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className='flex justify-end gap-3'>
        <Button
          type='button'
          variant='outline'
          onClick={() => navigate({ to: webhooksPath })}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type='submit' disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Webhook' : 'Update Webhook'}
        </Button>
      </div>
    </form>
  )
}
