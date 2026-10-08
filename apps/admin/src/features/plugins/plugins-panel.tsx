import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { usePlugins, useTogglePlugin } from './api'

export function PluginsPanel() {
  const { data: plugins = [], isLoading } = usePlugins()
  const togglePlugin = useTogglePlugin()

  return (
    <div className='space-y-4'>
      <div>
        <h4 className='text-sm font-semibold uppercase tracking-wide text-muted-foreground'>
          Plugins
        </h4>
        <p className='text-sm text-muted-foreground'>
          Runtime plugin manifests loaded from worker configuration.
        </p>
      </div>

      {isLoading ? (
        <p className='text-sm text-muted-foreground'>Loading plugins...</p>
      ) : plugins.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No plugins configured.</p>
      ) : (
        <div className='grid gap-3'>
          {plugins.map((plugin) => (
            <Card key={plugin.name}>
              <CardHeader className='pb-2'>
                <CardTitle className='flex items-center justify-between text-base'>
                  <span className='text-sm'>
                    {plugin.metadata?.displayName ?? plugin.name}
                  </span>
                  <div className='flex items-center gap-2'>
                    <Switch
                      checked={plugin.enabled}
                      onCheckedChange={(checked) =>
                        togglePlugin.mutate({
                          pluginName: plugin.name,
                          enabled: checked,
                        })
                      }
                      disabled={plugin.status === 'blocked' || togglePlugin.isPending}
                      aria-label={`Toggle ${plugin.name}`}
                    />
                    <Badge
                      variant={
                        plugin.status === 'loaded'
                          ? 'default'
                          : plugin.status === 'disabled'
                            ? 'secondary'
                            : 'destructive'
                      }
                    >
                      {plugin.status === 'loaded'
                        ? 'Loaded'
                        : plugin.status === 'disabled'
                          ? 'Disabled'
                          : 'Blocked'}
                    </Badge>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className='pt-0'>
                {plugin.metadata ? (
                  <div className='mb-3 space-y-1 text-xs text-muted-foreground'>
                    <p>{plugin.metadata.description}</p>
                    <p>
                      Version {plugin.metadata.version}
                      {plugin.metadata.category ? ` • ${plugin.metadata.category}` : ''}
                    </p>
                  </div>
                ) : null}
                <p className='text-xs text-muted-foreground'>
                  Hooks: {plugin.hooks.length > 0 ? plugin.hooks.join(', ') : 'none'}
                </p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  AI tools: {plugin.aiTools.length > 0 ? plugin.aiTools.join(', ') : 'none'}
                </p>
                <p className='mt-1 text-xs text-muted-foreground'>
                  Routes: {plugin.routes.length > 0 ? plugin.routes.join(', ') : 'none'}
                </p>
                {plugin.adminMenu.length > 0 ? (
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Admin menu:{' '}
                    {plugin.adminMenu.map((item) => `${item.label} (${item.path})`).join(', ')}
                  </p>
                ) : null}
                {plugin.reason ? (
                  <p className='mt-1 text-xs text-muted-foreground'>{plugin.reason}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
