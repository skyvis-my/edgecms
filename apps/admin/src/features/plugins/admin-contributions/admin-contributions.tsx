import { useLocation } from '@tanstack/react-router'
import { ExternalLink, Info, Puzzle, TriangleAlert, X } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode, useState } from 'react'
import type { PluginAdminPanelSlot } from '@edgecms/plugin-sdk'
import { NavGroup } from '@/components/layout/nav-group'
import type { NavGroup as NavGroupData } from '@/components/layout/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { resolveTenantSlugFromPathname } from '@/lib/tenant-route'
import { cn } from '@/lib/utils'
import { adminContributionRegistry } from './registry'
import type { AdminContributionComponent, AdminContributionIcon } from './types'
import { useVisibleAdminContributions } from './use-admin-contributions'

type Registry = typeof adminContributionRegistry

const DEFAULT_NAV_GROUP = 'Extensions'

export function pluginPagePath(tenantSlug: string, pluginName: string, pageId: string): string {
  return `/tenants/${tenantSlug}/plugins/${pluginName}/${pageId}`
}

/** Keeps a crashing plugin component from taking the admin down with it. */
class ContributionBoundary extends Component<
  { pluginName: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[plugins] "${this.props.pluginName}" admin component failed`, error, info)
  }

  render() {
    if (this.state.failed) {
      return (
        <p className='text-sm text-muted-foreground' role='status'>
          This {this.props.pluginName} section could not load.
        </p>
      )
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// Sidebar navigation
// ---------------------------------------------------------------------------

export function PluginNavGroups({
  tenantSlug,
  registry = adminContributionRegistry,
}: {
  tenantSlug: string | null
  registry?: Registry
}) {
  if (!tenantSlug || registry.navItems.length === 0) return null
  return <VisiblePluginNavGroups tenantSlug={tenantSlug} registry={registry} />
}

function VisiblePluginNavGroups({ tenantSlug, registry }: { tenantSlug: string; registry: Registry }) {
  const { navItems } = useVisibleAdminContributions(tenantSlug, registry)
  if (navItems.length === 0) return null

  const groups = new Map<string, NavGroupData>()
  for (const item of navItems) {
    const title = item.group ?? DEFAULT_NAV_GROUP
    const group = groups.get(title) ?? { title, items: [] }
    group.items.push({
      title: item.label,
      url: pluginPagePath(tenantSlug, item.pluginName, item.id),
      icon: (item.icon as AdminContributionIcon | undefined) ?? Puzzle,
    })
    groups.set(title, group)
  }

  return (
    <>
      {[...groups.values()].map((group) => (
        <NavGroup key={`plugin-group-${group.title}`} {...group} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Plugin pages (route: /tenants/:tenantSlug/plugins/:pluginName/:pageId)
// ---------------------------------------------------------------------------

export function PluginContributionPage({
  tenantSlug,
  pluginName,
  pageId,
  registry = adminContributionRegistry,
}: {
  tenantSlug: string
  pluginName: string
  pageId: string
  registry?: Registry
}) {
  const { navItems } = useVisibleAdminContributions(tenantSlug, registry)
  const item = navItems.find((nav) => nav.pluginName === pluginName && nav.id === pageId)

  if (!item) {
    return (
      <div className='rounded-lg border border-dashed p-8 text-center' role='status'>
        <h1 className='text-lg font-semibold'>Page not available</h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          This plugin page does not exist, its plugin is turned off, or your role cannot open it.
        </p>
      </div>
    )
  }

  const Page = item.component as AdminContributionComponent
  return (
    <section aria-labelledby='plugin-page-title' className='flex flex-col gap-4'>
      <div>
        <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
          {item.pluginName}
        </p>
        <h1 id='plugin-page-title' className='text-2xl font-bold tracking-tight'>
          {item.label}
        </h1>
      </div>
      <ContributionBoundary pluginName={item.pluginName}>
        <Page pluginName={item.pluginName} tenantSlug={tenantSlug} />
      </ContributionBoundary>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Panel slots
// ---------------------------------------------------------------------------

export function PluginPanelSlot({
  slot,
  tenantSlug,
  className,
  registry = adminContributionRegistry,
}: {
  slot: PluginAdminPanelSlot
  tenantSlug: string | null
  className?: string
  registry?: Registry
}) {
  if (!registry.panels.some((panel) => panel.slot === slot)) return null
  return (
    <VisiblePluginPanels slot={slot} tenantSlug={tenantSlug} className={className} registry={registry} />
  )
}

function VisiblePluginPanels({
  slot,
  tenantSlug,
  className,
  registry,
}: {
  slot: PluginAdminPanelSlot
  tenantSlug: string | null
  className?: string
  registry: Registry
}) {
  const { panelsFor } = useVisibleAdminContributions(tenantSlug, registry)
  const panels = panelsFor(slot)
  if (panels.length === 0) return null

  return (
    <div data-plugin-slot={slot} className={cn('grid gap-4 md:grid-cols-2', className)}>
      {panels.map((panel) => {
        const Panel = panel.component as AdminContributionComponent
        return (
          <Card key={`${panel.pluginName}:${panel.id}`} data-plugin={panel.pluginName}>
            <CardHeader>
              <CardTitle>{panel.title}</CardTitle>
              {panel.description ? <CardDescription>{panel.description}</CardDescription> : null}
            </CardHeader>
            <CardContent>
              <ContributionBoundary pluginName={panel.pluginName}>
                <Panel pluginName={panel.pluginName} tenantSlug={tenantSlug} />
              </ContributionBoundary>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

const DISMISS_KEY_PREFIX = 'edgecms:plugin-banner-dismissed:'

function dismissKey(pluginName: string, bannerId: string): string {
  return `${DISMISS_KEY_PREFIX}${pluginName}:${bannerId}`
}

function readDismissed(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeDismissed(key: string): void {
  try {
    globalThis.localStorage?.setItem(key, '1')
  } catch {
    // Storage blocked: the banner still hides for this page view.
  }
}

export function PluginBanners({
  tenantSlug,
  registry = adminContributionRegistry,
}: {
  tenantSlug: string | null
  registry?: Registry
}) {
  if (registry.banners.length === 0) return null
  return <VisiblePluginBanners tenantSlug={tenantSlug} registry={registry} />
}

/** Banners for the authenticated shell; the tenant comes from the current path. */
export function LayoutPluginBanners({ registry = adminContributionRegistry }: { registry?: Registry }) {
  if (registry.banners.length === 0) return null
  return <LocationPluginBanners registry={registry} />
}

function LocationPluginBanners({ registry }: { registry: Registry }) {
  const pathname = useLocation({ select: (location) => location.pathname })
  return (
    <VisiblePluginBanners tenantSlug={resolveTenantSlugFromPathname(pathname || '/')} registry={registry} />
  )
}

function VisiblePluginBanners({ tenantSlug, registry }: { tenantSlug: string | null; registry: Registry }) {
  const { banners } = useVisibleAdminContributions(tenantSlug, registry)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())

  const shown = banners.filter((banner) => {
    const key = dismissKey(banner.pluginName, banner.id)
    return !dismissed.has(key) && !(banner.dismissible !== false && readDismissed(key))
  })
  if (shown.length === 0) return null

  return (
    <div className='flex flex-col gap-2 px-4 pt-3' data-plugin-banners=''>
      {shown.map((banner) => {
        const key = dismissKey(banner.pluginName, banner.id)
        const isWarning = banner.tone === 'warning'
        const Icon = isWarning ? TriangleAlert : Info
        const external = banner.link?.href.startsWith('https://') ?? false
        return (
          <div
            key={key}
            role={isWarning ? 'alert' : 'status'}
            data-plugin={banner.pluginName}
            data-tone={banner.tone}
            className={cn(
              'flex items-start gap-3 rounded-md border px-3 py-2 text-sm',
              isWarning
                ? 'border-orange-300 bg-orange-50 text-orange-950 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-100'
                : 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100'
            )}
          >
            <Icon className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
            <p className='flex-1'>
              {banner.message}
              {banner.link ? (
                <>
                  {' '}
                  <a
                    href={banner.link.href}
                    className='inline-flex items-center gap-1 font-medium underline underline-offset-2'
                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    {banner.link.label}
                    {external ? <ExternalLink className='size-3' aria-hidden='true' /> : null}
                  </a>
                </>
              ) : null}
            </p>
            {banner.dismissible !== false ? (
              <button
                type='button'
                className='rounded p-0.5 opacity-70 hover:opacity-100 focus-visible:outline-2'
                aria-label={`Dismiss: ${banner.message}`}
                onClick={() => {
                  writeDismissed(key)
                  setDismissed((current) => new Set(current).add(key))
                }}
              >
                <X className='size-4' aria-hidden='true' />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
