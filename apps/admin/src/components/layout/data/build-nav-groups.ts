import type { NavCollapsible, NavGroup, NavItem, NavLink } from '../types'

function prefixTenantNavPath(path: string, tenantSlug: string | null): string {
  if (!tenantSlug || !path.startsWith('/')) {
    return path
  }
  if (path === '/' || path === '/admin' || path.startsWith('/admin/')) {
    return path
  }
  if (path === '/admin/tenants' || path.startsWith('/admin/tenants/')) {
    return path
  }
  const tenantPrefix = `/tenants/${tenantSlug}`
  if (path === tenantPrefix || path.startsWith(`${tenantPrefix}/`)) {
    return path
  }
  return `${tenantPrefix}${path}`
}

function mapNavItemsWithTenantPrefix(
  items: NavGroup['items'],
  tenantSlug: string | null
): NavGroup['items'] {
  const isCollapsible = (item: NavItem): item is NavCollapsible =>
    Array.isArray((item as { items?: unknown }).items)

  return items.map((item): NavItem => {
    if (isCollapsible(item)) {
      const collapsibleItem = item as NavCollapsible
      return {
        items: collapsibleItem.items.map((child) => ({
          ...child,
          url:
            typeof child.url === 'string' ? prefixTenantNavPath(child.url, tenantSlug) : child.url,
        })),
        title: collapsibleItem.title,
        badge: collapsibleItem.badge,
        icon: collapsibleItem.icon,
      }
    }

    const linkItem = item as NavLink
    const url =
      typeof linkItem.url === 'string'
        ? prefixTenantNavPath(linkItem.url, tenantSlug)
        : linkItem.url

    return {
      ...linkItem,
      url,
    }
  })
}

export function buildNavGroups(
  baseNavGroups: NavGroup[],
  tenantSlug: string | null = null
): NavGroup[] {
  return baseNavGroups.map((group) => ({
    ...group,
    items: mapNavItemsWithTenantPrefix(group.items, tenantSlug),
  }))
}
