import type { Asset } from './api'
import { splitAssetFilename } from './media-utils'

export type AssetSortBy = 'uploadedAt' | 'filename' | 'size' | 'mimeType'
export type SortDirection = 'asc' | 'desc'

function buildPublicAssetsBasePath(tenantSlug: string | null | undefined): string {
  return tenantSlug
    ? `/api/tenants/${encodeURIComponent(tenantSlug)}/api/public/assets`
    : '/api/public/assets'
}

export function buildAssetDownloadPath(
  asset: Pick<Asset, 'id'>,
  tenantSlug?: string | null
): string {
  return `${buildPublicAssetsBasePath(tenantSlug)}/${encodeURIComponent(asset.id)}/original`
}

export function buildAssetVariantPath(
  asset: Pick<Asset, 'id'>,
  variant: Pick<Asset['variants'][number], 'variant' | 'format'>,
  tenantSlug?: string | null
): string {
  return `${buildPublicAssetsBasePath(tenantSlug)}/${encodeURIComponent(asset.id)}/${encodeURIComponent(
    variant.variant
  )}.${encodeURIComponent(variant.format)}`
}

export function getMimeCategory(mimeType: string): string {
  const category = mimeType.split('/')[0]
  return category?.trim().toLowerCase() || 'unknown'
}

export function getMimeCategoryOptions(assets: Asset[]): string[] {
  return [...new Set(assets.map((asset) => getMimeCategory(asset.mimeType)))].sort((a, b) =>
    a.localeCompare(b)
  )
}

export function assetMatchesManagerQuery(asset: Asset, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  const { folder, basename } = splitAssetFilename(asset.filename)
  return [asset.filename, basename, folder, asset.mimeType]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(normalizedQuery))
}

export function filterAssetsForManager(
  assets: Asset[],
  query: string,
  mimeCategoryFilter: string
): Asset[] {
  const normalizedMimeFilter = mimeCategoryFilter.trim().toLowerCase()

  return assets.filter((asset) => {
    if (
      normalizedMimeFilter !== 'all' &&
      getMimeCategory(asset.mimeType) !== normalizedMimeFilter
    ) {
      return false
    }

    return assetMatchesManagerQuery(asset, query)
  })
}

export function sortAssetsForManager(
  assets: Asset[],
  sortBy: AssetSortBy,
  direction: SortDirection
): Asset[] {
  const next = [...assets]
  const dir = direction === 'asc' ? 1 : -1

  next.sort((a, b) => {
    if (sortBy === 'uploadedAt') {
      const aTime = Date.parse(a.createdAt ?? '')
      const bTime = Date.parse(b.createdAt ?? '')
      const normalizedATime = Number.isNaN(aTime) ? 0 : aTime
      const normalizedBTime = Number.isNaN(bTime) ? 0 : bTime
      if (normalizedATime === normalizedBTime) return a.filename.localeCompare(b.filename) * dir
      return (normalizedATime - normalizedBTime) * dir
    }

    if (sortBy === 'size') {
      if (a.size === b.size) return a.filename.localeCompare(b.filename) * dir
      return (a.size - b.size) * dir
    }

    if (sortBy === 'mimeType') {
      const mimeCompare = a.mimeType.localeCompare(b.mimeType)
      if (mimeCompare === 0) return a.filename.localeCompare(b.filename) * dir
      return mimeCompare * dir
    }

    const fileCompare = a.filename.localeCompare(b.filename)
    return fileCompare * dir
  })

  return next
}

export function summarizeAssets(assets: Asset[]): { count: number; totalBytes: number } {
  return {
    count: assets.length,
    totalBytes: assets.reduce((sum, asset) => sum + asset.size, 0),
  }
}
