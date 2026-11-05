import { hostPlanSampleContributions } from './samples/host-plan-sample'
import type { AdminContributionCatalogEntry } from './types'

/**
 * HS-10 build-time trusted catalog of admin contributions (P8).
 *
 * Add an entry here to let a trusted plugin contribute sidebar pages, panels
 * and banners. Entries are compiled into the admin bundle; nothing is loaded
 * at runtime. A host such as a hosted EdgeCMS service keeps its own entries in
 * its fork or composition package.
 *
 * The sample host plugin is off by default. Build or run the admin with
 * `VITE_EDGECMS_SAMPLE_HOST_PLUGIN=true` to see it.
 */
function isSampleEnabled(): boolean {
  try {
    return import.meta.env?.VITE_EDGECMS_SAMPLE_HOST_PLUGIN === 'true'
  } catch {
    return false
  }
}

export const trustedAdminContributionCatalog: AdminContributionCatalogEntry[] = isSampleEnabled()
  ? [hostPlanSampleContributions]
  : []
