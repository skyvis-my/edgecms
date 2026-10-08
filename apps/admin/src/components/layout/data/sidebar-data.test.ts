import { describe, expect, it } from 'bun:test'
import { getSidebarNavGroups } from './sidebar-data'

describe('getSidebarNavGroups', () => {
  it('returns global-only management groups when no tenant is active', () => {
    const groups = getSidebarNavGroups(null)

    const allTitles = groups.flatMap((group) => group.items.map((item) => item.title))
    expect(allTitles).toContain('Tenants')
    expect(allTitles).toContain('Users')
    expect(allTitles).not.toContain('Publishing')
    expect(allTitles).not.toContain('Settings')
  })

  it('returns tenant CMS groups when tenant is active', () => {
    const groups = getSidebarNavGroups('acme')

    const allTitles = groups.flatMap((group) => group.items.map((item) => item.title))
    expect(allTitles).not.toContain('Dashboard')
    expect(allTitles).toContain('Content Models')
    expect(allTitles).toContain('Publishing')
    expect(allTitles).toContain('Users')
    expect(allTitles).not.toContain('Tenants')
    expect(allTitles).toContain('Settings')
    expect(allTitles).toContain('Plugins')
  })

  it('points plugin management at the tenant plugins page', () => {
    const groups = getSidebarNavGroups('acme')
    const pluginsItem = groups
      .flatMap((group) => group.items)
      .find((item) => item.title === 'Plugins')

    expect(pluginsItem).toMatchObject({ url: '/plugins' })
  })
})
