import type { ComponentType } from 'react'
import type { TrustedAdminContributionEntry } from '@edgecms/plugin-sdk'

/** Props every plugin-contributed page or panel receives. */
export type AdminContributionComponentProps = {
  pluginName: string
  /** Active tenant workspace, or `null` on global pages such as the dashboard. */
  tenantSlug: string | null
}

export type AdminContributionComponent = ComponentType<AdminContributionComponentProps>

export type AdminContributionIcon = ComponentType<{ className?: string }>

/** The admin renders React components; icons and pages share this type. */
export type AdminContributionCatalogEntry = TrustedAdminContributionEntry<
  AdminContributionComponent | AdminContributionIcon
>
