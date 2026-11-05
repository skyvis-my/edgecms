import { composeAdminContributions } from '@edgecms/plugin-sdk'
import { trustedAdminContributionCatalog } from './catalog'
import type { AdminContributionCatalogEntry } from './types'

export function createAdminContributionRegistry(catalog: readonly AdminContributionCatalogEntry[]) {
  const composed = composeAdminContributions(catalog)
  for (const rejected of composed.rejected) {
    // Fail closed and loud: the plugin renders nothing, and the build-time
    // catalog test fails before this ships.
    console.error(
      `[plugins] admin contributions from "${rejected.pluginName}" were rejected`,
      rejected.issues
    )
  }
  return composed
}

/** Composed once at module load from the build-time catalog. */
export const adminContributionRegistry = createAdminContributionRegistry(
  trustedAdminContributionCatalog
)

export function hasAnyAdminContributions(
  registry: Pick<typeof adminContributionRegistry, 'navItems' | 'panels' | 'banners'>
): boolean {
  return registry.navItems.length + registry.panels.length + registry.banners.length > 0
}
