import { describe, expect, it } from 'bun:test'
import type { Asset } from './api'
import {
  buildAssetFilename,
  buildFolderTree,
  filterAssetsByFolder,
  formatBytes,
  getMovedFolderPath,
  normalizeFolderPath,
  splitAssetFilename,
} from './media-utils'

describe('media-utils', () => {
  it('normalizes folder paths', () => {
    expect(normalizeFolderPath('/marketing//spring\\hero/')).toBe('marketing/spring/hero')
  })

  it('splits and builds filenames with nested folders', () => {
    expect(splitAssetFilename('marketing/spring/banner.webp')).toEqual({
      folder: 'marketing/spring',
      basename: 'banner.webp',
    })
    expect(buildAssetFilename('marketing/spring', 'banner.webp')).toBe(
      'marketing/spring/banner.webp'
    )
  })

  it('builds folder tree from asset filenames and explicit folders', () => {
    const assets = [
      {
        id: '1',
        filename: 'marketing/spring/a.webp',
        mimeType: 'image/webp',
        size: 1,
        variants: [],
      },
      {
        id: '2',
        filename: 'marketing/summer/b.webp',
        mimeType: 'image/webp',
        size: 1,
        variants: [],
      },
    ] satisfies Asset[]
    const tree = buildFolderTree(assets, ['drafts/ideas'])
    expect(tree.map((node) => node.path)).toEqual(['drafts', 'marketing'])
  })

  it('filters assets by selected folder', () => {
    const assets = [
      {
        id: '1',
        filename: 'marketing/spring/a.webp',
        mimeType: 'image/webp',
        size: 1,
        variants: [],
      },
      {
        id: '2',
        filename: 'marketing/summer/b.webp',
        mimeType: 'image/webp',
        size: 1,
        variants: [],
      },
      { id: '3', filename: 'c.webp', mimeType: 'image/webp', size: 1, variants: [] },
    ] satisfies Asset[]
    expect(filterAssetsByFolder(assets, 'marketing/spring').map((a) => a.id)).toEqual(['1'])
  })

  it('formats byte sizes', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('computes moved folder paths for drag-drop moves', () => {
    expect(getMovedFolderPath('marketing/spring', 'archive')).toBe('archive/spring')
    expect(getMovedFolderPath('marketing/spring', '')).toBe('spring')
  })

  it('returns null when folder move would be invalid or a no-op', () => {
    expect(getMovedFolderPath('marketing', 'marketing')).toBeNull()
    expect(getMovedFolderPath('marketing', 'marketing/spring')).toBeNull()
    expect(getMovedFolderPath('marketing/spring', 'marketing')).toBeNull()
  })
})
