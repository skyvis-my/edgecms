import type { NavGroup } from '../types'

export function getNavGroupKey(group: NavGroup, index: number): string {
  const firstItemUrl = group.items[0]?.url
  return `${group.title}-${firstItemUrl ?? index}`
}
