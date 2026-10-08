import type { Asset } from './api'
import type { ContextMenuState, FileManagerEntry } from './media-manager-types'
import { splitAssetFilename } from './media-utils'

type MediaContextMenuProps = {
  contextMenu: ContextMenuState & { open: true; entry: FileManagerEntry }
  selectedAssetIds: string[]
  getAssetDownloadPath: (asset: Asset) => string
  getAssetSizeLabel: (asset: Asset) => string
  onOpenFolder: (path: string) => void
  onMoveSelectedToFolder: (path: string) => void
  onRenameFolder: (path: string) => void
  onOpenPreview: (assetId: string) => void
  onCopyAssetLink: (asset: Asset) => void
  onOpenContainingFolder: (folder: string) => void
  onDeleteAsset: (assetId: string) => void
  onClose: () => void
}

export function MediaContextMenu({
  contextMenu,
  selectedAssetIds,
  getAssetDownloadPath,
  getAssetSizeLabel,
  onOpenFolder,
  onMoveSelectedToFolder,
  onRenameFolder,
  onOpenPreview,
  onCopyAssetLink,
  onOpenContainingFolder,
  onDeleteAsset,
  onClose,
}: MediaContextMenuProps) {
  const entry = contextMenu.entry

  return (
    <div
      className='fixed z-50 min-w-48 rounded-md border bg-popover p-1 text-sm shadow-md'
      style={{ left: contextMenu.x, top: contextMenu.y }}
      role='menu'
      aria-label='Media actions'
    >
      {entry.type === 'folder' ? (
        <>
          <button
            type='button'
            role='menuitem'
            className='w-full rounded px-2 py-1 text-left hover:bg-muted'
            onClick={() => onOpenFolder(entry.path)}
          >
            Open Folder
          </button>
          <button
            type='button'
            role='menuitem'
            className='w-full rounded px-2 py-1 text-left hover:bg-muted'
            onClick={() => {
              if (selectedAssetIds.length === 0) return
              onMoveSelectedToFolder(entry.path)
              onClose()
            }}
          >
            Move Selected Here
          </button>
          <button
            type='button'
            role='menuitem'
            className='w-full rounded px-2 py-1 text-left hover:bg-muted'
            onClick={() => {
              onRenameFolder(entry.path)
              onClose()
            }}
          >
            Rename Folder
          </button>
        </>
      ) : (
        <>
          <button
            type='button'
            role='menuitem'
            className='w-full rounded px-2 py-1 text-left hover:bg-muted'
            onClick={() => {
              onOpenPreview(entry.asset.id)
              onClose()
            }}
          >
            Open Preview
          </button>
          <div className='px-2 py-1 text-xs text-muted-foreground'>
            {getAssetSizeLabel(entry.asset)}
          </div>
          <a
            role='menuitem'
            className='block w-full rounded px-2 py-1 text-left hover:bg-muted'
            href={getAssetDownloadPath(entry.asset)}
            download={splitAssetFilename(entry.asset.filename).basename}
            onClick={onClose}
          >
            Download Original
          </a>
          <button
            type='button'
            role='menuitem'
            className='w-full rounded px-2 py-1 text-left hover:bg-muted'
            onClick={() => {
              onCopyAssetLink(entry.asset)
              onClose()
            }}
          >
            Copy Link
          </button>
          <button
            type='button'
            role='menuitem'
            className='w-full rounded px-2 py-1 text-left hover:bg-muted'
            onClick={() => {
              onOpenContainingFolder(
                splitAssetFilename(entry.asset.filename).folder
              )
              onClose()
            }}
          >
            Open Containing Folder
          </button>
          <button
            type='button'
            role='menuitem'
            className='w-full rounded px-2 py-1 text-left text-destructive hover:bg-muted'
            onClick={() => {
              onDeleteAsset(entry.asset.id)
              onClose()
            }}
          >
            Delete
          </button>
        </>
      )}
    </div>
  )
}
