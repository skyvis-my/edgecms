import { Link, useLocation } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { useLayout } from '@/context/layout-provider'
import { useCollections } from '@/features/collections/api/collections-api'
import { TenantSwitcher } from '@/features/tenants/components/tenant-switcher'
import { useSession } from '@/lib/auth-client'
import { resolveTenantSlugFromPathname } from '@/lib/tenant-route'
// import { AppTitle } from './app-title'
import { buildNavGroups } from './data/build-nav-groups'
import { getNavGroupKey } from './data/nav-group-key'
import { getSidebarNavGroups, sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const { pathname } = useLocation()
  const { state, isMobile, setOpenMobile } = useSidebar()
  const { data: sessionData } = useSession()
  const { data: collections, isLoading: isLoadingCollections } = useCollections()
  const [collectionFilter, setCollectionFilter] = useState('')
  const [debouncedCollectionFilter, setDebouncedCollectionFilter] = useState('')
  const sessionUser = sessionData?.user
  const activeTenantSlug = resolveTenantSlugFromPathname(pathname || '/')
  const navGroups = buildNavGroups(getSidebarNavGroups(activeTenantSlug), activeTenantSlug)
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedCollectionFilter(collectionFilter)
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [collectionFilter])

  const visibleCollections = useMemo(() => {
    if (!activeTenantSlug || !collections?.length) {
      return []
    }
    const normalizedFilter = debouncedCollectionFilter.trim().toLowerCase()
    if (!normalizedFilter) {
      return collections
    }
    return collections.filter((collection) => {
      return (
        collection.name.toLowerCase().includes(normalizedFilter) ||
        collection.slug.toLowerCase().includes(normalizedFilter)
      )
    })
  }, [activeTenantSlug, collections, debouncedCollectionFilter])
  const showCollectionIndex = !!activeTenantSlug && (state !== 'collapsed' || isMobile)
  const sidebarUser = {
    name: sessionUser?.name ?? sidebarData.user.name,
    email: sessionUser?.email ?? sidebarData.user.email,
    avatar: sessionUser?.image ?? sidebarData.user.avatar,
  }

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TenantSwitcher />

        {/* Replace <TenantSwitcher /> with the following <AppTitle />
         /* if you want to use the normal app title instead of tenant switcher dropdown */}
        {/* <AppTitle /> */}
      </SidebarHeader>
      <SidebarContent>
        {showCollectionIndex && (
          <SidebarGroup>
            <SidebarGroupLabel>Content</SidebarGroupLabel>
            <div className='px-2 pb-2'>
              <div className='relative'>
                <Search className='pointer-events-none absolute left-2 top-2.5 size-3.5 text-muted-foreground' />
                <Input
                  value={collectionFilter}
                  onChange={(event) => setCollectionFilter(event.target.value)}
                  placeholder='Filter entries...'
                  className='h-8 pl-7 text-xs'
                  aria-label='Filter collections'
                />
              </div>
            </div>
            <SidebarMenu>
              {isLoadingCollections ? (
                <SidebarMenuItem>
                  <div className='px-2 py-1 text-xs text-muted-foreground' aria-live='polite'>
                    Loading content...
                  </div>
                </SidebarMenuItem>
              ) : visibleCollections.length === 0 ? (
                <SidebarMenuItem>
                  <div className='px-2 py-1 text-xs text-muted-foreground' aria-live='polite'>
                    No content found
                  </div>
                </SidebarMenuItem>
              ) : (
                visibleCollections.map((collection) => {
                  const collectionEntriesPath = `/tenants/${activeTenantSlug}/collections/${collection.slug}/entries`
                  const isActive = pathname.startsWith(collectionEntriesPath)
                  return (
                    <SidebarMenuItem key={collection.id}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={collection.name}>
                        <Link
                          to={collectionEntriesPath}
                          preload='intent'
                          preloadDelay={80}
                          onClick={() => setOpenMobile(false)}
                        >
                          <span className='truncate'>{collection.name}</span>
                          {collection.singleton ? (
                            <span className='ml-auto text-[10px] text-muted-foreground'>
                              singleton
                            </span>
                          ) : null}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })
              )}
            </SidebarMenu>
          </SidebarGroup>
        )}
        {navGroups.map((props, index) => (
          <NavGroup key={getNavGroupKey(props, index)} {...props} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={sidebarUser} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
