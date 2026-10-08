import { Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { SkipToMain } from '@/components/skip-to-main'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { SyncProvider } from '@/features/sync/sync-provider'
import { getCookie } from '@/lib/cookies'
import { luxuryMotion } from '@/lib/luxury-motion'
import { cn } from '@/lib/utils'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'

  useEffect(() => {
    const focusMain = () => {
      const main = document.getElementById('content')
      if (!main) return
      main.setAttribute('tabindex', '-1')
      main.focus()
    }

    const originalPush = window.history.pushState
    const originalReplace = window.history.replaceState

    window.history.pushState = function (...args) {
      originalPush.apply(this, args)
      queueMicrotask(focusMain)
    }
    window.history.replaceState = function (...args) {
      originalReplace.apply(this, args)
      queueMicrotask(focusMain)
    }

    window.addEventListener('popstate', focusMain)
    focusMain()

    return () => {
      window.history.pushState = originalPush
      window.history.replaceState = originalReplace
      window.removeEventListener('popstate', focusMain)
    }
  }, [])

  return (
    <SyncProvider>
      <SearchProvider>
        <LayoutProvider>
          <SidebarProvider defaultOpen={defaultOpen}>
            <SkipToMain />
            <AppSidebar />
            <SidebarInset
              className={cn(
                // Set content container, so we can use container queries
                '@container/content',

                // If layout is fixed, set the height
                // to 100svh to prevent overflow
                'has-data-[layout=fixed]:h-svh',

                // If layout is fixed and sidebar is inset,
                // set the height to 100svh - spacing (total margins) to prevent overflow
                'peer-data-[variant=inset]:has-data-[layout=fixed]:h-[calc(100svh-(var(--spacing)*4))]',
                luxuryMotion.shell
              )}
            >
              {children ?? <Outlet />}
            </SidebarInset>
          </SidebarProvider>
        </LayoutProvider>
      </SearchProvider>
    </SyncProvider>
  )
}
