import { describe, expect, it } from 'bun:test'
import { buildNavGroups } from './build-nav-groups'
import { sidebarData } from './sidebar-data'

describe('buildNavGroups', () => {
  it('prefixes sidebar routes with /tenants/:slug in tenant mode', () => {
    const groups = buildNavGroups(sidebarData.navGroups, 'acme')
    const cmsGroup = groups.find((group) => group.title === 'CMS')
    const usersItem = cmsGroup?.items.find((item) => item.title === 'Users')
    const contentModelsItem = cmsGroup?.items.find((item) => item.title === 'Content Models')
    expect(usersItem).toMatchObject({ url: '/tenants/acme/users' })
    expect(contentModelsItem).toMatchObject({ url: '/tenants/acme/collections' })
  })

  it('prefixes sync route with /tenants/:slug in tenant mode', () => {
    const groups = buildNavGroups(sidebarData.navGroups, 'acme')
    const systemGroup = groups.find((group) => group.title === 'System')
    const syncItem = systemGroup?.items.find((item) => item.title === 'Sync')
    const pluginsItem = systemGroup?.items.find((item) => item.title === 'Plugins')
    expect(syncItem).toMatchObject({ url: '/tenants/acme/sync' })
    expect(pluginsItem).toMatchObject({ url: '/tenants/acme/plugins' })
  })

  it('does not prefix global tenant admin routes', () => {
    const groups = buildNavGroups(
      [
        {
          title: 'Administration',
          items: [{ title: 'Tenants', url: '/admin/tenants' }],
        },
      ],
      'acme'
    )
    expect(groups[0]?.items[0]).toMatchObject({ url: '/admin/tenants' })
  })

  it('does not prefix root-level global routes in tenant mode', () => {
    const groups = buildNavGroups(
      [
        {
          title: 'Global',
          items: [{ title: 'Dashboard', url: '/' }],
        },
      ],
      'acme'
    )

    expect(groups[0]?.items[0]).toMatchObject({ url: '/' })
  })
})
