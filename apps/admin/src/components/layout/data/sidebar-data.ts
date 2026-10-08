import {
  Bell,
  Bug,
  Building2,
  CalendarClock,
  Command,
  Construction,
  FileX,
  Images,
  LayoutDashboard,
  Lock,
  Monitor,
  Palette,
  Plug,
  RefreshCw,
  ServerOff,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  UserX,
  Webhook,
  Wrench,
} from 'lucide-react'
import type { SidebarData } from '../types'

const tenantNavGroups: SidebarData['navGroups'] = [
  {
    title: 'CMS',
    items: [
      {
        title: 'Content Models',
        url: '/collections',
        icon: Construction,
      },
      {
        title: 'Users',
        url: '/users',
        icon: Users,
      },
      {
        title: 'Publishing',
        url: '/publishing',
        icon: CalendarClock,
      },
      {
        title: 'Media',
        url: '/media',
        icon: Images,
      },
      {
        title: 'Webhooks',
        url: '/webhooks',
        icon: Webhook,
      },
    ],
  },
  {
    title: 'System',
    items: [
      {
        title: 'Sync',
        url: '/sync',
        icon: RefreshCw,
      },
      {
        title: 'Settings',
        url: '/settings',
        icon: Settings,
      },
      {
        title: 'Plugins',
        url: '/plugins',
        icon: Plug,
      },
    ],
  },
]

const globalNavGroups: SidebarData['navGroups'] = [
  {
    title: 'Global',
    items: [
      {
        title: 'Dashboard',
        url: '/',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        title: 'Users',
        url: '/admin/users',
        icon: Users,
      },
      {
        title: 'Tenants',
        url: '/admin/tenants',
        icon: Building2,
      },
    ],
  },
]

export function getSidebarNavGroups(activeTenantSlug: string | null): SidebarData['navGroups'] {
  return activeTenantSlug ? tenantNavGroups : globalNavGroups
}

export const sidebarData: SidebarData = {
  user: {
    name: 'Unknown User',
    email: 'unknown@localhost',
    avatar: '/avatars/shadcn.jpg',
  },
  teams: [
    {
      name: 'EdgeCMS',
      logo: Command,
      plan: 'Admin Console',
    },
  ],
  navGroups: [
    ...tenantNavGroups,
    {
      title: 'Pages',
      items: [
        {
          title: 'Auth',
          icon: ShieldCheck,
          items: [
            {
              title: 'Sign In',
              url: '/sign-in',
            },
            {
              title: 'Sign Up',
              url: '/sign-up',
            },
            {
              title: 'Forgot Password',
              url: '/forgot-password',
            },
            {
              title: 'OTP',
              url: '/otp',
            },
          ],
        },
        {
          title: 'Errors',
          icon: Bug,
          items: [
            {
              title: 'Unauthorized',
              url: '/errors/unauthorized',
              icon: Lock,
            },
            {
              title: 'Forbidden',
              url: '/errors/forbidden',
              icon: UserX,
            },
            {
              title: 'Not Found',
              url: '/errors/not-found',
              icon: FileX,
            },
            {
              title: 'Internal Server Error',
              url: '/errors/internal-server-error',
              icon: ServerOff,
            },
            {
              title: 'Maintenance Error',
              url: '/errors/maintenance-error',
              icon: Construction,
            },
          ],
        },
      ],
    },
    {
      title: 'Other',
      items: [
        {
          title: 'Settings',
          icon: Settings,
          items: [
            {
              title: 'Profile',
              url: '/settings',
              icon: UserCog,
            },
            {
              title: 'Account',
              url: '/settings/account',
              icon: Wrench,
            },
            {
              title: 'Appearance',
              url: '/settings/appearance',
              icon: Palette,
            },
            {
              title: 'Notifications',
              url: '/settings/notifications',
              icon: Bell,
            },
            {
              title: 'Display',
              url: '/settings/display',
              icon: Monitor,
            },
          ],
        },
      ],
    },
  ],
}
