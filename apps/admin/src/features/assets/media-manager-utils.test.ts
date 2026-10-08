import { describe, expect, it } from 'bun:test'
import type { Asset } from './api'
import {
  assetMatchesManagerQuery,
  buildAssetDownloadPath,
  buildAssetVariantPath,
  filterAssetsForManager,
  getMimeCategoryOptions,
  sortAssetsForManager,
  summarizeAssets,
} from './media-manager-utils'

const fixtureAssets: Asset[] = [
  {
    id: 'a1',
    filename: 'marketing/spring/campaign.webp',
    mimeType: 'image/webp',
    size: 1200,
    createdAt: '2026-02-01T10:00:00Z',
    variants: [],
  },
  {
    id: 'a2',
    filename: 'marketing/video/launch.mp4',
    mimeType: 'video/mp4',
    size: 4800,
    createdAt: '2026-02-02T10:00:00Z',
    variants: [],
  },
  {
    id: 'a3',
    filename: 'docs/brand-guidelines.pdf',
    mimeType: 'application/pdf',
    size: 3200,
    createdAt: '2026-01-20T10:00:00Z',
    variants: [],
  },
  {
    id: 'a4',
    filename: 'docs/guide/notes.pdf',
    mimeType: 'application/pdf',
    size: 3200,
    createdAt: '2026-01-20T10:00:00Z',
    variants: [],
  },
]

describe('media-manager-utils', () => {
  it('builds original asset download paths', () => {
    expect(buildAssetDownloadPath({ id: 'asset 1/hero' })).toBe(
      '/api/public/assets/asset%201%2Fhero/original'
    )
  })

  it('builds tenant-scoped public asset paths', () => {
    expect(buildAssetDownloadPath({ id: 'asset 1/hero' }, 'nf-cheong')).toBe(
      '/api/tenants/nf-cheong/api/public/assets/asset%201%2Fhero/original'
    )
    expect(
      buildAssetVariantPath(
        { id: 'asset 1/hero' },
        { variant: 'medium', format: 'webp' },
        'nf-cheong'
      )
    ).toBe('/api/tenants/nf-cheong/api/public/assets/asset%201%2Fhero/medium.webp')
  })

  it('builds stable mime category options', () => {
    expect(getMimeCategoryOptions(fixtureAssets)).toEqual(['application', 'image', 'video'])
  })

  it('filters by query across filename, folder and mime type', () => {
    expect(filterAssetsForManager(fixtureAssets, 'spring', 'all').map((asset) => asset.id)).toEqual(
      ['a1']
    )
    expect(filterAssetsForManager(fixtureAssets, 'video', 'all').map((asset) => asset.id)).toEqual([
      'a2',
    ])
    expect(
      filterAssetsForManager(fixtureAssets, 'application', 'all').map((asset) => asset.id)
    ).toEqual(['a3', 'a4'])
  })

  it('filters by query using case-insensitive matching and folder/mime fields', () => {
    expect(filterAssetsForManager(fixtureAssets, 'SPRI', 'all').map((asset) => asset.id)).toEqual([
      'a1',
    ])
    expect(
      filterAssetsForManager(fixtureAssets, 'docs/guide', 'all').map((asset) => asset.id)
    ).toEqual(['a4'])
    expect(filterAssetsForManager(fixtureAssets, 'PDF', 'all').map((asset) => asset.id)).toEqual([
      'a3',
      'a4',
    ])
  })

  it('shares keyword matching across manager and picker workspaces', () => {
    expect(assetMatchesManagerQuery(fixtureAssets[0], 'spring')).toBeTrue()
    expect(assetMatchesManagerQuery(fixtureAssets[0], 'docs')).toBeFalse()
    expect(assetMatchesManagerQuery(fixtureAssets[3], 'docs/guide')).toBeTrue()
  })

  it('filters by mime category', () => {
    expect(filterAssetsForManager(fixtureAssets, '', 'image').map((asset) => asset.id)).toEqual([
      'a1',
    ])
    expect(filterAssetsForManager(fixtureAssets, '', 'video').map((asset) => asset.id)).toEqual([
      'a2',
    ])
  })

  it('ignores unknown mime categories when filtering', () => {
    expect(filterAssetsForManager(fixtureAssets, '', 'audio').length).toBe(0)
  })

  it('sorts by uploaded date descending and size ascending', () => {
    expect(
      sortAssetsForManager(fixtureAssets, 'uploadedAt', 'desc').map((asset) => asset.id)
    ).toEqual(['a2', 'a1', 'a4', 'a3'])
    expect(sortAssetsForManager(fixtureAssets, 'size', 'asc').map((asset) => asset.id)).toEqual([
      'a1',
      'a3',
      'a4',
      'a2',
    ])
  })

  it('sorts with filename tie-breakers for stable deterministic order', () => {
    expect(sortAssetsForManager(fixtureAssets, 'mimeType', 'asc').map((asset) => asset.id)).toEqual([
      'a3',
      'a4',
      'a1',
      'a2',
    ])
  })

  it('summarizes asset count and bytes', () => {
    expect(summarizeAssets(fixtureAssets)).toEqual({ count: 4, totalBytes: 12400 })
  })
})
