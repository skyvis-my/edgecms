import { useMemo } from 'react'
import type { PluginAdminPanelSlot } from '@edgecms/plugin-sdk'
import { usePlugins } from '../api'
import { canViewContribution, isContributingPluginActive, resolveViewerAccess } from './access'
import { adminContributionRegistry } from './registry'
import { useAdminViewer } from './viewer'

type Registry = typeof adminContributionRegistry

/**
 * Contributions the current viewer may see: the plugin is active (EX-01) and
 * the viewer holds each item's access level. Nav items exist only inside a
 * tenant workspace because their routes are tenant-scoped.
 */
export function useVisibleAdminContributions(
  tenantSlug: string | null,
  registry: Registry = adminContributionRegistry
) {
  const viewer = useAdminViewer(tenantSlug)
  const { data: apiPlugins } = usePlugins()

  return useMemo(() => {
    const access = resolveViewerAccess(viewer)
    const visible = <T extends { pluginName: string; requiresLoadedApiPlugin: boolean; access: Parameters<typeof canViewContribution>[0] }>(
      item: T
    ) =>
      canViewContribution(item.access, access) &&
      isContributingPluginActive(item.pluginName, item.requiresLoadedApiPlugin, apiPlugins)

    return {
      navItems: tenantSlug ? registry.navItems.filter(visible) : [],
      panels: registry.panels.filter(visible),
      banners: registry.banners.filter(visible),
      panelsFor: (slot: PluginAdminPanelSlot) =>
        registry.panels.filter((panel) => panel.slot === slot && visible(panel)),
    }
  }, [apiPlugins, registry, tenantSlug, viewer])
}
