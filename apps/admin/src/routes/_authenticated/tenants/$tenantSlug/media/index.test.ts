import { describe, expect, it } from 'bun:test'
import {
  buildMediaManagerPathNavigation,
  buildMediaManagerSearch,
  normalizeMediaManagerPath,
} from './index'

describe('normalizeMediaManagerPath', () => {
  it('normalizes nested folder paths for URL state', () => {
    expect(normalizeMediaManagerPath('///marketing//hero//')).toBe('marketing/hero')
  })

  it('treats missing URL path as root', () => {
    expect(normalizeMediaManagerPath(undefined)).toBe('')
  })
})

describe('buildMediaManagerSearch', () => {
  it('persists non-root folder path into search params', () => {
    expect(buildMediaManagerSearch('marketing/hero')).toEqual({ path: 'marketing/hero' })
  })

  it('removes path search param when navigating back to root', () => {
    expect(buildMediaManagerSearch('')).toEqual({ path: undefined })
  })

  it('normalizes whitespace-only path as root', () => {
    expect(buildMediaManagerSearch('   ')).toEqual({ path: undefined })
  })
})

describe('buildMediaManagerPathNavigation', () => {
  it('disables view transition for query-only media path updates', () => {
    const navigation = buildMediaManagerPathNavigation('marketing/hero')

    expect(navigation.viewTransition).toBeFalse()
    expect(navigation.search({})).toEqual({ path: 'marketing/hero' })
  })

  it('preserves unrelated search fields while setting media path', () => {
    const navigation = buildMediaManagerPathNavigation('marketing/hero')

    expect(navigation.search({ page: 2, filter: 'latest' } as never)).toEqual({
      page: 2,
      filter: 'latest',
      path: 'marketing/hero',
    })
  })
})
