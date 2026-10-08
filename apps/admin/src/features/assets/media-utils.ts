import type { Asset } from './api'

export type FolderNode = {
  name: string
  path: string
  children: FolderNode[]
}

export function normalizeFolderPath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((segment: string) => segment.trim())
    .filter(Boolean)
    .join('/')
}

export function splitAssetFilename(filename: string): { folder: string; basename: string } {
  const normalized = normalizeFolderPath(filename)
  if (!normalized.includes('/')) {
    return { folder: '', basename: normalized }
  }
  const parts = normalized.split('/')
  const basename = parts.pop() ?? ''
  return { folder: parts.join('/'), basename }
}

export function buildAssetFilename(folder: string, basename: string): string {
  const cleanFolder = normalizeFolderPath(folder)
  const cleanBasename = basename.trim().replace(/\//g, '')
  return cleanFolder ? `${cleanFolder}/${cleanBasename}` : cleanBasename
}

export function buildFolderTree(assets: Asset[], extraFolders: string[] = []): FolderNode[] {
  const folderSet = new Set<string>()
  for (const folder of extraFolders.map(normalizeFolderPath).filter(Boolean)) {
    const segments = folder.split('/')
    for (let i = 1; i <= segments.length; i++) {
      folderSet.add(segments.slice(0, i).join('/'))
    }
  }
  for (const asset of assets) {
    const { folder } = splitAssetFilename(asset.filename)
    if (!folder) continue
    const segments = folder.split('/')
    for (let i = 1; i <= segments.length; i++) {
      folderSet.add(segments.slice(0, i).join('/'))
    }
  }

  const roots: FolderNode[] = []
  const byPath = new Map<string, FolderNode>()
  const sorted = [...folderSet].sort((a, b) => a.localeCompare(b))
  for (const path of sorted) {
    const segments = path.split('/')
    const node: FolderNode = {
      name: segments[segments.length - 1] ?? path,
      path,
      children: [],
    }
    byPath.set(path, node)
    if (segments.length === 1) {
      roots.push(node)
      continue
    }
    const parentPath = segments.slice(0, -1).join('/')
    byPath.get(parentPath)?.children.push(node)
  }

  return roots
}

export function filterAssetsByFolder(assets: Asset[], folderPath: string): Asset[] {
  const normalizedFolder = normalizeFolderPath(folderPath)
  if (!normalizedFolder) return assets
  return assets.filter((asset) => splitAssetFilename(asset.filename).folder === normalizedFolder)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[idx]}`
}

export function getMovedFolderPath(sourcePath: string, targetPath: string): string | null {
  const source = normalizeFolderPath(sourcePath)
  const target = normalizeFolderPath(targetPath)
  if (!source) return null
  if (target === source || target.startsWith(`${source}/`)) return null

  const sourceSegments = source.split('/')
  const sourceName = sourceSegments[sourceSegments.length - 1] ?? source
  const nextPath = normalizeFolderPath(target ? `${target}/${sourceName}` : sourceName)
  if (!nextPath || nextPath === source) return null
  return nextPath
}
