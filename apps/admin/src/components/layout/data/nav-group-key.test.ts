import { describe, expect, it } from 'bun:test'
import type { NavGroup } from '../types'
import { getNavGroupKey } from './nav-group-key'

function makeGroup(title: string, firstUrl?: string): NavGroup {
  return {
    title,
    items: [
      {
        title: 'Item',
        url: firstUrl ?? '/default',
      },
    ],
  }
}

describe('getNavGroupKey', () => {
  it('returns different keys for duplicate titles with different first item urls', () => {
    const globalAdmin = makeGroup('Administration', '/admin/users')
    const tenantAdmin = makeGroup('Administration', '/tenants/acme/users')

    expect(getNavGroupKey(globalAdmin, 0)).not.toBe(getNavGroupKey(tenantAdmin, 1))
  })

  it('falls back to index when first item url is unavailable', () => {
    const brokenGroup = { title: 'Administration', items: [] } as unknown as NavGroup

    expect(getNavGroupKey(brokenGroup, 3)).toBe('Administration-3')
  })
})
