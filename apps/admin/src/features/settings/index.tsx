import { Outlet } from '@tanstack/react-router'
import { Bell, Monitor, Palette, UserCog, Wrench } from 'lucide-react'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Separator } from '@/components/ui/separator'
import { useCurrentTenantSlug } from '@/features/tenants/api'
import { SidebarNav } from './components/sidebar-nav'

export function Settings() {
  const { data: tenantSlug } = useCurrentTenantSlug()
  const settingsBasePath = tenantSlug ? `/tenants/${tenantSlug}/settings` : '/settings'
  const sidebarNavItems = [
    {
      title: 'Profile',
      href: settingsBasePath,
      icon: <UserCog size={18} />,
    },
    {
      title: 'Account',
      href: `${settingsBasePath}/account`,
      icon: <Wrench size={18} />,
    },
    {
      title: 'Appearance',
      href: `${settingsBasePath}/appearance`,
      icon: <Palette size={18} />,
    },
    {
      title: 'Notifications',
      href: `${settingsBasePath}/notifications`,
      icon: <Bell size={18} />,
    },
    {
      title: 'Display',
      href: `${settingsBasePath}/display`,
      icon: <Monitor size={18} />,
    },
  ]

  return (
    <>
      {/* ===== Top Heading ===== */}
      <Header>
        <Search />
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main fixed>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>Settings</h1>
          <p className='text-muted-foreground'>
            Manage your account settings and set e-mail preferences.
          </p>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div className='flex flex-1 flex-col space-y-2 overflow-hidden md:space-y-2 lg:flex-row lg:space-y-0 lg:space-x-12'>
          <aside className='top-0 lg:sticky lg:w-1/5'>
            <SidebarNav items={sidebarNavItems} />
          </aside>
          <div className='flex w-full overflow-y-hidden p-1'>
            <Outlet />
          </div>
        </div>
      </Main>
    </>
  )
}
