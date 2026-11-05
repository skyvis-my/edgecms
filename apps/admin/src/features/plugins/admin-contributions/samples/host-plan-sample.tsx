import { Gauge } from 'lucide-react'
import type { AdminContributionCatalogEntry, AdminContributionComponentProps } from '../types'

/**
 * Sample host plugin for HS-10. Every number here is illustrative; a real
 * host reads its own plan and usage API (for example the HS-05 usage sink).
 */
const SAMPLE_USAGE = [
  { label: 'Entries', used: 1840, limit: 2500 },
  { label: 'Media storage (GB)', used: 3.2, limit: 10 },
  { label: 'AI tokens this month', used: 410_000, limit: 500_000 },
] as const

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)
}

function UsageMeters() {
  return (
    <ul className='flex flex-col gap-3'>
      {SAMPLE_USAGE.map((row) => {
        const percent = Math.min(100, Math.round((row.used / row.limit) * 100))
        return (
          <li key={row.label} className='flex flex-col gap-1'>
            <div className='flex items-baseline justify-between text-sm'>
              <span>{row.label}</span>
              <span className='tabular-nums text-muted-foreground'>
                {formatNumber(row.used)} / {formatNumber(row.limit)}
              </span>
            </div>
            <div
              className='h-2 overflow-hidden rounded-full bg-muted'
              role='meter'
              aria-label={row.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div
                className={percent >= 80 ? 'h-full bg-orange-500' : 'h-full bg-primary'}
                style={{ width: `${percent}%` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function SampleLabel() {
  return (
    <p className='mt-3 text-xs text-muted-foreground'>
      Sample data from the example host plugin. Not your real usage.
    </p>
  )
}

export function HostPlanUsagePanel(_props: AdminContributionComponentProps) {
  return (
    <div>
      <p className='mb-3 text-sm'>
        Plan: <span className='font-semibold'>Team (sample)</span>
      </p>
      <UsageMeters />
      <SampleLabel />
    </div>
  )
}

export function HostPlanPage({ tenantSlug }: AdminContributionComponentProps) {
  return (
    <div className='grid gap-6 lg:grid-cols-[2fr_1fr]'>
      <div className='rounded-lg border p-4'>
        <h2 className='mb-3 font-semibold'>Usage for {tenantSlug ?? 'this deployment'}</h2>
        <UsageMeters />
        <SampleLabel />
      </div>
      <div className='rounded-lg border p-4 text-sm'>
        <h2 className='mb-2 font-semibold'>How this page got here</h2>
        <p className='text-muted-foreground'>
          A trusted host plugin listed in the admin's build-time catalog added this page, its
          sidebar link, the dashboard panel and the banner. Core admin code did not change.
        </p>
      </div>
    </div>
  )
}

export const hostPlanSampleContributions: AdminContributionCatalogEntry = {
  pluginName: 'sample-host-plan',
  contributions: {
    navItems: [
      {
        id: 'plan',
        label: 'Plan & usage',
        group: 'Host',
        access: 'tenant:manage',
        icon: Gauge,
        component: HostPlanPage,
      },
    ],
    panels: [
      {
        id: 'usage',
        slot: 'dashboard',
        title: 'Plan usage',
        description: 'Contributed by the sample host plugin.',
        access: 'tenant:read',
        component: HostPlanUsagePanel,
      },
      {
        id: 'settings-usage',
        slot: 'settings',
        title: 'Plan usage',
        description: 'Contributed by the sample host plugin.',
        access: 'tenant:manage',
        component: HostPlanUsagePanel,
      },
    ],
    banners: [
      {
        id: 'near-limit',
        tone: 'warning',
        message: 'Sample host plugin: entries are at 74% of the sample plan limit.',
        access: 'tenant:manage',
        link: {
          label: 'How contributions work',
          href: 'https://github.com/skyvis-my/edgecms/blob/main/docs/public/plugin-sdk.md#admin-contributions-hs-10',
        },
      },
    ],
  },
}
