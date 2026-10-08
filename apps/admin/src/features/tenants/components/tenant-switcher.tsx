import { useLocation, useNavigate } from '@tanstack/react-router'
import { Building2, Check, ChevronsUpDown, Clock3, Globe, MoveRight, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  buildTenantAdminUrl,
  buildTenantRedirectUrl,
  isTenantManagementPath,
  resolveTenantSlugFromLocation,
} from '@/lib/tenant-route'
import { cn } from '@/lib/utils'
import { luxuryMotion } from '@/lib/luxury-motion'
import { getCurrentTenantSlug, setCurrentTenantSlug, useTenants } from '../api'
import {
  extractTenantSlugFromHistoryPath,
  getTenantHistoryStorageKey,
  readTenantHistory,
  recordTenantHistory,
  removeTenantHistoryItem,
  resolveHistoryPathForTenant,
  type TenantHistoryItem,
} from './tenant-history'

export function TenantSwitcher() {
  const { isMobile } = useSidebar()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: tenants = [] } = useTenants()
  const [history, setHistory] = useState<TenantHistoryItem[]>([])

  const activeSlugFromUrl =
    typeof window !== 'undefined' ? resolveTenantSlugFromLocation(window.location.href) : null
  const activeSlug = activeSlugFromUrl
  const activeTenant = activeSlug ? tenants.find((t) => t.slug === activeSlug) : null
  const historyStorageKey = useMemo(() => getTenantHistoryStorageKey(activeSlug), [activeSlug])
  const currentPathRef = useRef<string | null>(null)
  const historyRowRefs = useRef(new Map<string, HTMLDivElement>())
  const previousRowTopByPath = useRef(new Map<string, number>())
  const currentPath = location.pathname || '/'
  const currentHistoryPath = useMemo(
    () => resolveHistoryPathForTenant(currentPath, activeSlug),
    [activeSlug, currentPath]
  )

  const handleTenantSwitch = (slug: string) => {
    const pathname = location.pathname || '/'
    const currentPath = `${pathname}${window.location.search}${window.location.hash}`
    const targetPath =
      isTenantManagementPath(pathname) || pathname.startsWith('/admin/')
        ? buildTenantAdminUrl(slug)
        : buildTenantRedirectUrl(currentPath, slug)

    setCurrentTenantSlug(slug)
    window.location.assign(targetPath)
  }

  const handleGlobalMode = () => {
    setCurrentTenantSlug(null)
    window.location.assign('/admin/tenants')
  }

  useEffect(() => {
    setHistory(readTenantHistory(historyStorageKey))
  }, [historyStorageKey])

  useEffect(() => {
    const currentSlug = getCurrentTenantSlug()
    if (activeSlugFromUrl && activeSlugFromUrl !== currentSlug) {
      setCurrentTenantSlug(activeSlugFromUrl)
      return
    }
    if (!activeSlugFromUrl && currentSlug) {
      setCurrentTenantSlug(null)
    }
  }, [activeSlugFromUrl])

  useEffect(() => {
    const previousPath = currentPathRef.current
    currentPathRef.current = currentPath
    if (!previousPath || previousPath === currentPath) return

    const next = recordTenantHistory(historyStorageKey, previousPath, undefined, activeSlug)
    setHistory(next)
  }, [activeSlug, currentPath, historyStorageKey])

  useLayoutEffect(() => {
    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) return

    const nextTopByPath = new Map<string, number>()
    for (const [path, node] of historyRowRefs.current) {
      const top = node.getBoundingClientRect().top
      nextTopByPath.set(path, top)
      const previousTop = previousRowTopByPath.current.get(path)
      if (previousTop === undefined) continue
      if (typeof node.animate !== 'function') continue

      const deltaY = previousTop - top
      if (Math.abs(deltaY) < 1) continue
      node.animate(
        [{ transform: `translate3d(0, ${deltaY}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
        {
          duration: 360,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        }
      )
    }
    previousRowTopByPath.current = nextTopByPath
  }, [history])

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size='lg'
              className={cn(
                'h-auto min-h-14 rounded-xl border border-sidebar-border/70 bg-gradient-to-b from-sidebar-accent/60 to-sidebar-accent/20 p-3',
                'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
              )}
            >
              <div className='flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary/85 text-sidebar-primary-foreground shadow-sm'>
                <Building2 className='size-4' />
              </div>
              <div className='grid flex-1 text-start leading-tight'>
                <span className='truncate text-sm font-semibold'>
                  {activeTenant ? activeTenant.name : 'EdgeCMS'}
                </span>
                <span className='truncate text-xs text-sidebar-foreground/70'>
                  {activeTenant
                    ? activeTenant.name === activeTenant.slug
                      ? 'Tenant'
                      : activeTenant.slug
                    : 'Super Admin'}
                </span>
              </div>
              <span className='rounded-md border border-sidebar-border/70 bg-sidebar/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/80 group-data-[collapsible=icon]:hidden'>
                {activeTenant ? 'Tenant' : 'Global'}
              </span>
              <ChevronsUpDown className='ms-auto' />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
            align='start'
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className='text-xs text-muted-foreground'>Tenants</DropdownMenuLabel>

            {/* Super Admin / Global Mode */}
            <DropdownMenuItem onClick={handleGlobalMode} className='gap-2 p-2'>
              <div className='flex size-6 items-center justify-center rounded-sm border'>
                <Building2 className='size-4 shrink-0' />
              </div>
              <div className='flex flex-1 items-center justify-between'>
                <span>Super Admin</span>
                {!activeSlug && <Check className='size-4' />}
              </div>
            </DropdownMenuItem>

            {tenants.length > 0 && <DropdownMenuSeparator />}

            {/* Tenant List */}
            {tenants.map((tenant) => (
              <DropdownMenuItem
                key={tenant.slug}
                onClick={() => handleTenantSwitch(tenant.slug)}
                className='gap-2 p-2'
              >
                <div className='flex size-6 items-center justify-center rounded-sm border'>
                  <Building2 className='size-4 shrink-0' />
                </div>
                <div className='flex flex-1 flex-col'>
                  <span className='text-sm font-medium'>{tenant.name}</span>
                  {tenant.name !== tenant.slug && (
                    <span className='text-xs text-muted-foreground'>{tenant.slug}</span>
                  )}
                </div>
                {activeSlug === tenant.slug && <Check className='size-4' />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      <SidebarMenuItem className='group-data-[collapsible=icon]:hidden'>
        <div
          className={cn(
            'rounded-xl border border-sidebar-border/60 bg-sidebar-accent/20 p-2',
            luxuryMotion.surface
          )}
        >
          <div className='mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/60'>
            <Clock3 className='size-3.5' />
            <span>Recent History</span>
          </div>
          <div className='space-y-1'>
            {history.slice(0, 5).map((entry) => {
              const tenantSlug = extractTenantSlugFromHistoryPath(entry.path)
              const isCurrent = entry.path === currentHistoryPath
              const historyIndex = history.findIndex((item) => item.path === entry.path)
              return (
                <div
                  key={entry.path}
                  ref={(node) => {
                    if (node) {
                      historyRowRefs.current.set(entry.path, node)
                      return
                    }
                    historyRowRefs.current.delete(entry.path)
                  }}
                  style={{ '--edge-history-order': historyIndex } as CSSProperties}
                  className='edge-history-item group/history flex w-full items-center gap-1 rounded-md pe-1 text-xs transition-colors hover:bg-sidebar-accent'
                >
                  <span
                    aria-hidden='true'
                    data-testid={isCurrent ? 'current-history-dot' : undefined}
                    className={cn(
                      'ms-1 size-1.5 rounded-full bg-transparent transition-colors',
                      isCurrent ? 'bg-sidebar-foreground/55' : ''
                    )}
                  />
                  <button
                    type='button'
                    onClick={() => navigate({ to: entry.path })}
                    className={cn(
                      'flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left text-sidebar-foreground/80',
                      'hover:text-sidebar-accent-foreground',
                      luxuryMotion.interactive
                    )}
                  >
                    <span className='truncate'>
                      <span className='font-semibold text-sidebar-foreground/95'>
                        {entry.label}
                      </span>
                      {tenantSlug ? (
                        <span className='font-normal text-sidebar-foreground/70'>
                          {' '}
                          - {tenantSlug}
                        </span>
                      ) : null}
                    </span>
                    <MoveRight className='size-3.5 opacity-0 transition-opacity group-hover/history:opacity-100' />
                  </button>
                  <button
                    type='button'
                    aria-label={`Clear history item ${entry.label}`}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      const next = removeTenantHistoryItem(historyStorageKey, entry.path)
                      setHistory(next)
                    }}
                    className={cn(
                      'inline-flex size-5 items-center justify-center rounded-sm border border-transparent text-sidebar-foreground/55',
                      'opacity-0 transition-all hover:border-sidebar-border/80 hover:bg-sidebar hover:text-sidebar-foreground group-hover/history:opacity-100',
                      luxuryMotion.interactive
                    )}
                  >
                    <X className='size-3' />
                  </button>
                </div>
              )
            })}
            {history.length === 0 && (
              <div className='px-2 py-1.5 text-xs text-sidebar-foreground/50'>
                No recent history
              </div>
            )}
          </div>
        </div>
      </SidebarMenuItem>

      <SidebarMenuItem className='group-data-[collapsible=icon]:hidden'>
        <div className='flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] text-sidebar-foreground/60'>
          <Globe className='size-3.5' />
          <span className='truncate'>
            {activeTenant ? `${activeTenant.slug}.edgecms.local` : 'global.edgecms.local'}
          </span>
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
