import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { edenGet, edenPut } from '@/lib/eden-client'
import { ContentSection } from '../components/content-section'

export type AiProvider = {
  id: string
  name: string
  operator: string
  route: string
  purpose: string
}

export type TenantAiSettings = {
  aiEnabled: boolean
  canManage: boolean
  providers: AiProvider[]
}

export const aiSettingsKey = ['settings', 'ai'] as const

/**
 * HS-14: the tenant's AI switch and the providers that receive content when it is on.
 */
export function SettingsAi() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: aiSettingsKey,
    queryFn: () => edenGet<TenantAiSettings>('/admin/settings/ai'),
  })
  const mutation = useMutation({
    mutationFn: (aiEnabled: boolean) =>
      edenPut<TenantAiSettings>('/admin/settings/ai', { aiEnabled }),
    onSuccess: (next) => {
      queryClient.setQueryData(aiSettingsKey, next)
      toast.success(next.aiEnabled ? 'AI features turned on' : 'AI features turned off')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Update failed'),
  })

  return (
    <ContentSection
      title='AI'
      desc='Choose whether this tenant’s content may be sent to AI providers.'
    >
      {isLoading ? (
        <Skeleton className='h-40 w-full' />
      ) : isError || !data ? (
        <p className='text-destructive text-sm'>AI settings could not be loaded.</p>
      ) : (
        <div className='space-y-6'>
          <div
            className={`flex items-start justify-between gap-4 rounded-lg border p-4 ${
              data.aiEnabled ? 'border-emerald-500/40 bg-emerald-500/5' : 'bg-muted/40'
            }`}
          >
            <div className='flex gap-3'>
              {data.aiEnabled ? (
                <ShieldCheck className='mt-0.5 size-5 text-emerald-600' aria-hidden />
              ) : (
                <ShieldOff className='text-muted-foreground mt-0.5 size-5' aria-hidden />
              )}
              <div className='space-y-1'>
                <Label htmlFor='ai-enabled' className='text-base'>
                  AI features
                </Label>
                <p className='text-muted-foreground text-sm'>
                  {data.aiEnabled
                    ? 'On: AI commands, workflows, imports, MCP agents and semantic search can read this tenant’s content.'
                    : 'Off: no content from this tenant is sent to the providers below.'}
                </p>
                {!data.canManage && (
                  <p className='text-muted-foreground text-xs'>
                    Only tenant owners and admins can change this.
                  </p>
                )}
              </div>
            </div>
            <Switch
              id='ai-enabled'
              checked={data.aiEnabled}
              disabled={!data.canManage || mutation.isPending}
              onCheckedChange={(checked) => mutation.mutate(checked)}
            />
          </div>

          <div className='space-y-3'>
            <h4 className='text-sm font-medium'>Who receives content when AI is on</h4>
            <ul className='divide-y rounded-lg border'>
              {data.providers.map((provider) => (
                <li key={provider.id} className='flex flex-col gap-1 p-4 sm:flex-row sm:gap-4'>
                  <div className='min-w-40'>
                    <p className='font-medium'>{provider.name}</p>
                    <p className='text-muted-foreground text-xs'>{provider.operator}</p>
                  </div>
                  <div className='flex-1 space-y-1'>
                    <p className='text-sm'>{provider.purpose}</p>
                    <Badge variant='outline' className='gap-1 font-normal'>
                      <ArrowRight className='size-3' aria-hidden />
                      via {provider.route}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
            <p className='text-muted-foreground text-xs'>
              Turning AI off stops new requests and embeddings. Embeddings created while it was
              on stay stored but are no longer searched; search falls back to keywords.
            </p>
          </div>
        </div>
      )}
    </ContentSection>
  )
}
