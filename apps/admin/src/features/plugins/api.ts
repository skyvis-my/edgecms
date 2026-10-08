import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { edenGet, edenPatch } from '@/lib/eden-client'

export type PluginMetadata = {
  displayName: string
  description: string
  version: string
  author?: string
  category?: string
  permissions?: string[]
}

export type PluginAdminMenuItem = {
  label: string
  path: string
  group?: string
}

export type PluginStatus = {
  name: string
  enabled: boolean
  hooks: string[]
  aiTools: string[]
  routes: string[]
  adminRoutes: string[]
  publicRoutes: string[]
  status: 'loaded' | 'blocked' | 'disabled'
  sandbox: 'trusted_catalog'
  metadata?: PluginMetadata
  adminMenu: PluginAdminMenuItem[]
  reason?: string
}

export const pluginsKeys = {
  all: ['plugins'] as const,
}

export function usePlugins() {
  return useQuery({
    queryKey: pluginsKeys.all,
    queryFn: async () => edenGet<PluginStatus[]>('/admin/plugins'),
  })
}

export function useTogglePlugin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ pluginName, enabled }: { pluginName: string; enabled: boolean }) => {
      return edenPatch<{ pluginName: string; enabled: boolean }>(
        `/admin/plugins/${pluginName}`,
        { enabled }
      )
    },
    onMutate: async ({ pluginName, enabled }) => {
      await queryClient.cancelQueries({ queryKey: pluginsKeys.all })
      const previousPlugins = queryClient.getQueryData<PluginStatus[]>(pluginsKeys.all)

      queryClient.setQueryData<PluginStatus[]>(pluginsKeys.all, (old) =>
        old?.map((plugin) =>
          plugin.name === pluginName
            ? {
                ...plugin,
                enabled,
                status: enabled ? 'loaded' : 'disabled',
              }
            : plugin
        )
      )

      return { previousPlugins }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousPlugins) {
        queryClient.setQueryData(pluginsKeys.all, context.previousPlugins)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pluginsKeys.all })
    },
  })
}
