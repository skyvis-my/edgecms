import type { Asset } from './api'

export type FolderEntry = { type: 'folder'; path: string; name: string }
export type AssetEntry = { type: 'asset'; asset: Asset }
export type FileManagerEntry = FolderEntry | AssetEntry

export type ContextMenuState =
  | { open: false; x: number; y: number }
  | { open: true; x: number; y: number; entry: FileManagerEntry }

export type MediaActivityStatus = 'success' | 'queued' | 'error'

export type MediaActivity = {
  id: string
  title: string
  detail: string
  status: MediaActivityStatus
  createdAt: string
}

export type HoverPreviewState = {
  asset: Asset
  previewPath: string
  basename: string
  folder: string
  anchorX: number
  anchorY: number
}

export type HoverPreviewLayout = {
  left: number
  top: number
  width: number
  imageHeight: number
}
