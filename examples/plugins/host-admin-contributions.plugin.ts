import {
  composeAdminContributions,
  type TrustedAdminContributionEntry,
} from '@edgecms/plugin-sdk'

/**
 * HS-10 example: a host plugin that adds a "Plan & usage" page, a dashboard
 * panel and a banner to the admin without editing core admin code.
 *
 * The SDK is framework-free, so this example uses a stand-in component type.
 * In the bundled React admin the components are React components; see
 * `apps/admin/src/features/plugins/admin-contributions/samples/host-plan-sample.tsx`
 * for the runnable version (`VITE_EDGECMS_SAMPLE_HOST_PLUGIN=true`).
 */
type Component = (props: { pluginName: string; tenantSlug: string | null }) => unknown

const PlanPage: Component = ({ tenantSlug }) => `Plan for ${tenantSlug ?? 'deployment'}`
const UsagePanel: Component = () => 'Usage meters'

export const hostAdminContributions = {
  pluginName: 'acme-host-plan',
  // Show only while the API reports the `acme-host-plan` plugin as loaded.
  requiresLoadedApiPlugin: true,
  contributions: {
    navItems: [
      {
        id: 'plan',
        label: 'Plan & usage',
        group: 'Host',
        access: 'tenant:manage',
        component: PlanPage,
      },
    ],
    panels: [
      {
        id: 'usage',
        slot: 'dashboard',
        title: 'Plan usage',
        access: 'tenant:read',
        component: UsagePanel,
      },
    ],
    banners: [
      {
        id: 'trial-ending',
        tone: 'warning',
        message: 'Your trial ends in 3 days.',
        access: 'tenant:manage',
        link: { label: 'Choose a plan', href: 'https://billing.example.com/plans' },
      },
    ],
  },
} satisfies TrustedAdminContributionEntry<Component>

// Validation runs when the admin composes its catalog. An invalid entry
// contributes nothing and is listed in `rejected`.
export const composed = composeAdminContributions([hostAdminContributions])
